import { expect, test } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';
import { logInWithCode } from './login';

// Phase 34 P34-B: the admin group "eGrant tím" (spec §10, scenarios 1, 2 and 6). One serial flow:
// production rate limits allow only a few code requests per minute.
test('admins share "eGrant tím"; a client never reaches it; it holds no tickets', async ({
  page: admin,
  browser,
}) => {
  const stamp = Date.now();

  // 1. Admin A opens it from the top of the home sidebar: its own "Interné" section.
  await admin.goto('/');
  const internal = admin.locator('section').filter({
    has: admin.getByRole('heading', { name: 'Interné' }),
  });
  await internal.getByRole('link', { name: /eGrant tím/ }).click();
  await expect(admin).toHaveURL(/\/groups\/[^/]+\/chat$/);
  const groupPath = new URL(admin.url()).pathname.replace(/\/chat$/, '');
  const groupId = groupPath.split('/').pop()!;

  const tabs = admin.getByRole('navigation', { name: 'Časti klienta' });
  // The e2e superadmin holds the finance right, so Financie is there too (Phase 34 P34-E fills it).
  await expect(tabs.getByRole('link')).toHaveText([
    /^Prehľad/,
    /^Chat/,
    /^Úlohy/,
    /^Znalosti/,
    /^Financie/,
  ]);
  await expect(tabs.getByRole('link', { name: 'Tikety' })).toHaveCount(0);
  await expect(tabs.getByRole('link', { name: 'Manažéri' })).toHaveCount(0);
  // No Tickets or Members screen even by address.
  await admin.goto(`${groupPath}/members`);
  await expect(admin.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();
  await admin.goto(`${groupPath}/chat`);

  const text = `E2E team message ${stamp}`;
  const box = admin.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill(text);
  await box.press('Enter');
  await expect(admin.locator('[data-message-id]').filter({ hasText: text })).toBeVisible();

  // Admin B: hears it under All messages by default and reads the message.
  const emailB = `e2e-team-${stamp}@example.com`;
  const added = await admin.request.post('/api/admins', {
    data: { email: emailB, name: `E2E Team B ${stamp}` },
  });
  expect(added.ok()).toBe(true);
  const contextB = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const pageB = await contextB.newPage();
  await logInWithCode(pageB, contextB.request, emailB);
  await pageB.goto(`${groupPath}/chat`);
  await expect(pageB.locator('[data-message-id]').filter({ hasText: text })).toBeVisible();
  await expect(pageB.getByRole('button', { name: 'Upozornenia: Všetky správy' })).toBeVisible();

  // 2. Assignees: every active admin is offered there, no client.
  const people = (await (await admin.request.get(`/api/groups/${groupId}/people`)).json()) as {
    id: string;
    isAdmin: boolean;
    isManager: boolean;
  }[];
  expect(people.every((p) => p.isAdmin && p.isManager)).toBe(true);
  await admin.goto(`${groupPath}/tasks/new`);
  await admin.getByRole('combobox', { name: 'Riešitelia' }).fill('E2E Team B');
  await expect(
    admin
      .getByRole('listbox', { name: 'Riešitelia' })
      .getByRole('option', { name: new RegExp(`E2E Team B ${stamp}`) }),
  ).toBeVisible();

  // 6. No tickets: the API refuses one for it.
  const ticket = await admin.request.post('/api/tickets', {
    data: { groupId, subject: `E2E ${stamp}`, requesterEmail: null, requesterName: null },
  });
  expect(ticket.status()).toBe(400);
  expect(((await ticket.json()) as { error: string }).error).toBe('invalid_group');

  // A client of another group has no way in: the address is not found, the API answers 404.
  const created = await admin.request.post('/api/groups', {
    data: { name: `E2E Team Client ${stamp}`, egrantUrl: `https://e2e-team-${stamp}.egrant.sk` },
  });
  const clientGroup = ((await created.json()) as { id: string }).id;
  await admin.goto(`/groups/${clientGroup}/members`);
  const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
  const email = `e2e-team-client-${stamp}@example.com`;
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await context.newPage();
  await client.goto(new URL(inviteUrl).pathname);
  await clearMailFor(context.request, email);
  await client.getByLabel('E-mail').fill(email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await client.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await client.getByLabel('Vaše meno').fill('E2E Team Client');
  await client.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(client).toHaveURL(new RegExp(`/groups/${clientGroup}/chat$`));
  await client.goto(`${groupPath}/chat`);
  await expect(client.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();
  await expect(client.getByText(text)).toHaveCount(0);
  expect((await context.request.get(`/api/groups/${groupId}/chat`)).status()).toBe(404);

  await context.close();
  await contextB.close();
});
