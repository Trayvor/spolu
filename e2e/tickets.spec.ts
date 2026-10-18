import { expect, test, type Page } from '@playwright/test';
import { clearMailFor, subjectsFor, waitForMessage } from './mailpit';

// Phase 21, part 21.7: the whole ticket flow, from eGrant's intake to tasks on the board.
const KEY = 'e2e-tickets-key-0123456789';

async function createGroup(page: Page, name: string, egrantUrl: string): Promise<string> {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Vytvoriť skupinu' }).first().click();
  await page.getByLabel('Názov').fill(name);
  await page.getByLabel('Adresa klienta v eGrant').fill(egrantUrl);
  await page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(page.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
  // The Groups page draws 50 rows at a time: find the group by name first.
  await page.getByRole('searchbox', { name: 'Nájsť skupinu' }).fill(name);
  await page.locator('a[href^="/groups/"]:not([href$="/chat"])', { hasText: name }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+\/chat$/);
  return new URL(page.url()).pathname.replace(/\/chat$/, '').replace('/groups/', '');
}

test('a ticket from eGrant: requester login, chat, status, email and tasks', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000); // the notification email is batched for 10 s on the e2e server
  const stamp = Date.now();
  const host = `e2e-flow-${stamp}.egrant.sk`;
  const email = `e2e-flow-requester-${stamp}@example.com`;
  const subject = `Rozpočet nejde uložiť ${stamp}`;
  const fileText = 'Krok 3: chyba pri uložení rozpočtu.';
  const groupId = await createGroup(page, `E2E Tiket tok ${stamp}`, `https://${host}`);

  // 1. eGrant sends the ticket with a small file as base64; a retry with the same request_id
  // answers the same ticket.
  const intake = (data: object) =>
    page.request.post('/api/tickets/intake', {
      headers: { authorization: `Bearer ${KEY}` },
      data,
    });
  const body = {
    request_id: `e2e-${stamp}`,
    subject,
    body: '- Opraviť krok rozpočtu\n- Odpísať žiadateľovi',
    area: 'Rozpočet',
    email,
    requester_name: 'E2E Žiadateľka',
    instance_url: `https://www.${host}/app/login`,
    files: [{ name: 'popis-chyby.txt', content_base64: Buffer.from(fileText).toString('base64') }],
  };
  const created = await intake(body);
  expect(created.status()).toBe(201);
  const { id, number } = (await created.json()) as { id: string; number: number };
  const retry = await intake(body);
  expect(retry.status()).toBe(200);
  expect(await retry.json()).toEqual({ id, number });
  // Another requester's ticket of the same client, which ours must never see.
  const foreign = await intake({
    subject: `Cudzí tiket ${stamp}`,
    email: `e2e-flow-other-${stamp}@example.com`,
    instance_url: `https://${host}`,
  });
  const foreignId = ((await foreign.json()) as { id: string }).id;

  // 2. The "Ticket created" email arrives once, with a one-click sign-in link (ADR 0022).
  const mail = await waitForMessage(page.request, email, /bol vytvorený/);
  expect(mail.Subject).toBe(`Tiket #${number} bol vytvorený: ${subject}`);
  const link = /https?:\/\/\S+\/t#[A-Za-z0-9_-]+/.exec(mail.Text)?.[0];
  expect(link).toBeDefined();
  expect((await subjectsFor(page.request, email)).filter((s) => /bol vytvorený/.test(s))).toEqual([
    mail.Subject,
  ]);

  // 3. The requester opens the link: signed in at once, no code, no password.
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const requester = await context.newPage();
  // Cleared so step 7 finds the notification email, not this one.
  await clearMailFor(context.request, email);
  const url = new URL(link!);
  await requester.goto(url.pathname + url.hash);
  await expect(requester).toHaveURL(new RegExp(`/tickets/${id}$`));
  await expect(requester.getByRole('heading', { name: subject })).toBeVisible();
  // The file eGrant sent is on the ticket, and the requester downloads it.
  await expect(requester.getByText('popis-chyby.txt')).toBeVisible();
  const ticket = (await (await context.request.get(`/api/tickets/${id}`)).json()) as {
    files: { id: string }[];
  };
  const download = await context.request.get(`/api/files/${ticket.files[0]!.id}`);
  expect(download.status()).toBe(200);
  expect(await download.text()).toBe(fileText);

  // 4. Only their own ticket; the client's group and other tickets stay closed.
  await requester.goto('/tickets');
  await expect(requester.getByRole('heading', { name: 'Moje tikety' })).toBeVisible();
  await expect(requester.getByRole('link', { name: new RegExp(subject) })).toBeVisible();
  await expect(
    requester.getByRole('link', { name: new RegExp(`Cudzí tiket ${stamp}`) }),
  ).toHaveCount(0);
  for (const url of [
    `/tickets/${foreignId}`,
    `/groups/${groupId}/chat`,
    `/groups/${groupId}/tasks`,
  ]) {
    await requester.goto(url);
    await expect(requester.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();
  }

  // 5. The requester writes in the ticket's chat, then leaves the page (an open chat reads the
  // replies, and read replies are not emailed).
  await requester.goto(`/tickets/${id}`);
  const box = requester.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill('Chyba sa zobrazí pri uložení.');
  await box.press('Enter');
  await expect(
    requester.locator('[data-message-id]').filter({ hasText: 'Chyba sa zobrazí pri uložení.' }),
  ).toBeVisible();
  await requester.goto('/settings');

  // 6. The admin answers and sets In progress.
  await page.goto(`/tickets/${id}`);
  await expect(
    page.locator('[data-message-id]').filter({ hasText: 'Chyba sa zobrazí pri uložení.' }),
  ).toBeVisible();
  await page.getByRole('combobox', { name: 'Stav' }).selectOption('in_progress');
  const adminBox = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await adminBox.fill('Pozrieme sa na to ešte dnes.');
  await adminBox.press('Enter');
  await expect(
    page.locator('[data-message-id]').filter({ hasText: 'Pozrieme sa na to ešte dnes.' }),
  ).toBeVisible();

  // 7. The requester's notification email arrives (ticket notifications go by email by default).
  const notice = await waitForMessage(
    context.request,
    email,
    new RegExp(`Tiket #${number}`),
    45_000,
  );
  expect(notice.Subject).not.toContain('bol vytvorený');
  await requester.goto(`/tickets/${id}`);
  await expect(
    requester.locator('[data-message-id]').filter({ hasText: 'Pozrieme sa na to ešte dnes.' }),
  ).toBeVisible();
  await expect(requester.getByText('V riešení').first()).toBeVisible();

  // 8. The admin turns the ticket into two tasks; both link back, and the ticket lists them.
  await page.getByRole('button', { name: 'Vytvoriť úlohy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vytvoriť úlohy' });
  await expect(dialog.getByRole('article')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Schváliť všetky' }).click();
  await dialog.getByRole('button', { name: 'Vytvoriť 2 úlohy' }).click();
  await expect(dialog).toHaveCount(0);
  const taskList = page.getByRole('region', { name: /^Úlohy/ }).getByRole('list');
  await expect(taskList.getByRole('link')).toHaveText([
    'Opraviť krok rozpočtu',
    'Odpísať žiadateľovi',
  ]);
  await taskList.getByRole('link', { name: 'Opraviť krok rozpočtu' }).click();
  const panel = page.getByRole('complementary', { name: 'Úloha' });
  await expect(panel.getByRole('link', { name: `#${number} ${subject}` })).toBeVisible();

  // The requester sees only the count, never the tasks.
  await requester.reload();
  await expect(requester.getByText('Premenený na 2 úlohy')).toBeVisible();
  await expect(requester.getByRole('link', { name: 'Opraviť krok rozpočtu' })).toHaveCount(0);

  // 9. Completing and deleting those tasks elsewhere updates the open ticket page live.
  await page.goto(`/tickets/${id}`);
  await expect(taskList.getByRole('link')).toHaveCount(2);
  const board = (await (await page.request.get(`/api/groups/${groupId}/board`)).json()) as {
    buckets: { id: string; kind: string }[];
    tasks: { id: string; title: string }[];
  };
  const done = board.buckets.find((b) => b.kind === 'done')!;
  const byTitle = (title: string) => board.tasks.find((t) => t.title === title)!.id;
  const move = await page.request.post(`/api/tasks/${byTitle('Opraviť krok rozpočtu')}/move`, {
    data: { bucketId: done.id, afterTaskId: null },
  });
  expect(move.status()).toBe(200);
  await expect(taskList.getByRole('link', { name: /Opraviť krok rozpočtu Hotová/ })).toBeVisible();
  const removed = await page.request.delete(`/api/tasks/${byTitle('Odpísať žiadateľovi')}`);
  expect(removed.status()).toBe(204);
  await expect(taskList.getByRole('link')).toHaveCount(1);
  await context.close();
});
