import { expect, test, type Page } from '@playwright/test';
import { waitForMessage } from './mailpit';

// "Navrhnúť odpoveď" (2026-10-19) on the fake ticket draft AI (AI_PROVIDER=fake in
// playwright.config.ts): it greets the requester, quotes the subject and cites the first
// knowledge item and the first similar ticket it was given. Nothing is sent until the admin
// sends the message.
const KEY = 'e2e-tickets-key-0123456789';

/** A word no other run writes ("zq" and the stamp's digits as letters), for the retrieval. */
const wordOf = (stamp: number) =>
  `zq${String(stamp)
    .split('')
    .map((d) => String.fromCharCode(97 + Number(d)))
    .join('')}`;

async function group(page: Page, name: string, host: string): Promise<string> {
  const res = await page.request.post('/api/groups', {
    data: { name, egrantUrl: `https://${host}` },
  });
  expect(res.status()).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function intake(page: Page, data: object): Promise<{ id: string; number: number }> {
  const res = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data,
  });
  expect(res.status()).toBe(201);
  return (await res.json()) as { id: string; number: number };
}

test('an admin drafts a ticket reply from shared knowledge and sends it', async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const w = wordOf(stamp);
  const host = `e2e-draft-${stamp}.egrant.sk`;
  const email = `e2e-draft-requester-${stamp}@example.com`;
  const groupId = await group(page, `E2E Návrh ${stamp}`, host);
  const note = await page.request.post(`/api/groups/${groupId}/knowledge`, {
    data: {
      type: 'note',
      title: `Zmena rozpočtu ${w}`,
      body: 'Zmenu rozpočtu pošlite cez formulár v eGrante.',
      visibility: 'public',
      fileIds: [],
      folderId: null,
    },
  });
  expect(note.status()).toBe(201);
  const subject = `Otázka k rozpočtu ${w}`;
  const { id } = await intake(page, {
    subject,
    body: 'Ako postupovať pri zmene rozpočtu?',
    email,
    requester_name: 'Klára Testová',
    instance_url: `https://${host}`,
  });

  await page.goto(`/tickets/${id}`);
  await page.getByRole('button', { name: 'Navrhnúť odpoveď' }).click();
  const dialog = page.getByTestId('ticket-draft');
  await dialog.getByRole('button', { name: 'Navrhnúť', exact: true }).click();
  await expect(dialog.getByText(`k vášmu tiketu „${subject}“`)).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Podklady' })).toBeVisible();
  await expect(dialog.getByText(`Zmena rozpočtu ${w}`)).toBeVisible();
  await dialog.getByRole('button', { name: 'Vložiť do správy' }).click();
  await expect(dialog).toHaveCount(0);

  const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await expect(box).toContainText('Dobrý deň Klára');
  // Nothing was sent yet.
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
  await box.press('End');
  await box.pressSequentially(' Ďakujeme.');
  await box.press('Enter');
  const sent = page.locator('[data-message-id]').filter({ hasText: 'Ďakujeme.' });
  await expect(sent).toBeVisible();
  await expect(sent).toContainText(`k vášmu tiketu „${subject}“`);

  // The requester sees the sent message only, and has no draft button.
  const mail = await waitForMessage(page.request, email, /bol vytvorený/);
  const link = /https?:\/\/\S+\/t#[A-Za-z0-9_-]+/.exec(mail.Text)?.[0];
  expect(link).toBeDefined();
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const requester = await context.newPage();
  const url = new URL(link!);
  await requester.goto(url.pathname + url.hash);
  await expect(requester).toHaveURL(new RegExp(`/tickets/${id}$`));
  await expect(
    requester.locator('[data-message-id]').filter({ hasText: 'Ďakujeme.' }),
  ).toBeVisible();
  await expect(requester.getByRole('textbox', { name: 'Napíšte správu…' })).toBeVisible();
  await expect(requester.getByRole('button', { name: 'Navrhnúť odpoveď' })).toHaveCount(0);
  await context.close();
});

test('a resolved ticket of another client helps, and the draft never names that client', async ({
  page,
}) => {
  const stamp = Date.now();
  const w = wordOf(stamp);
  const hostA = `e2e-draft-a-${stamp}.egrant.sk`;
  const hostB = `e2e-draft-b-${stamp}.egrant.sk`;
  await group(page, `E2E Klient A ${stamp}`, hostA);
  const clientB = `Obec Béčkovo ${stamp}`;
  await group(page, clientB, hostB);
  const resolved = await intake(page, {
    subject: `Rozpočet ${w} pre ${clientB}`,
    body: 'Píše Bohuslav Lehotský, bohuslav@beckovo.sk.',
    email: `e2e-draft-b-${stamp}@example.com`,
    requester_name: 'Bohuslav Lehotský',
    instance_url: `https://${hostB}`,
  });
  const patched = await page.request.patch(`/api/tickets/${resolved.id}`, {
    data: { status: 'resolved' },
  });
  expect(patched.ok()).toBe(true);
  const { id } = await intake(page, {
    subject: `Zmena rozpočtu ${w}`,
    body: 'Ako ďalej?',
    email: `e2e-draft-a-${stamp}@example.com`,
    requester_name: 'Alena Áčková',
    instance_url: `https://${hostA}`,
  });

  await page.goto(`/tickets/${id}`);
  await page.getByRole('button', { name: 'Navrhnúť odpoveď' }).click();
  const dialog = page.getByTestId('ticket-draft');
  await dialog.getByRole('button', { name: 'Navrhnúť', exact: true }).click();
  // The admin sees the example under Podklady, as a link to it.
  const example = dialog.getByRole('link', { name: new RegExp(`^#${resolved.number} `) });
  await expect(example).toBeVisible();
  await expect(example).toHaveAttribute('href', `/tickets/${resolved.id}`);
  await dialog.getByRole('button', { name: 'Vložiť do správy' }).click();
  const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await expect(box).toContainText('Dobrý deň Alena');
  for (const leak of ['Béčkovo', 'Bohuslav', 'Lehotský', 'beckovo']) {
    await expect(box).not.toContainText(leak);
  }
});
