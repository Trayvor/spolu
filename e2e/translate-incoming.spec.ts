import { expect, test } from '@playwright/test';
import { logInWithCode } from './login';

// 2026-10-19 (ADR 0061): a message someone else wrote, read in one's own language, on the fake
// text tools (AI_PROVIDER=fake): an untagged text is "German" and comes back as "[Slovak] …".
test('a received message on a foreign instance translates in place, with the original a click away', async ({
  page: admin,
  browser,
}) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await admin.request.post('/api/groups', {
    data: { name: `E2E translate ${stamp}`, egrantUrl: `https://e2e-tr-${stamp}.egrant.cz` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  const channel = (await (await admin.request.get(`/api/groups/${group.id}/chat`)).json()) as {
    id: string;
  };

  // Another admin writes a message.
  const emailB = `e2e-tr-${stamp}@example.com`;
  expect(
    (
      await admin.request.post('/api/admins', { data: { email: emailB, name: `E2E Tr ${stamp}` } })
    ).ok(),
  ).toBe(true);
  const contextB = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const pageB = await contextB.newPage();
  await logInWithCode(pageB, contextB.request, emailB);
  const text = `Guten Tag ${stamp}`;
  const sent = await contextB.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: text, clientId: `e2e-${stamp}` },
  });
  expect(sent.status()).toBe(201);
  await contextB.close();

  await admin.goto(`/groups/${group.id}/chat`);
  const own = `Moja správa ${stamp}`;
  const box = admin.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill(own);
  await box.press('Enter');

  const received = admin.locator('[data-message-id]').filter({ hasText: text });
  await received.hover();
  await received.getByRole('button', { name: 'Preložiť' }).click();
  await expect(received.getByText(`[Slovak] ${text}`)).toBeVisible();
  await expect(received.getByText('Preložené z jazyka: nemčina')).toBeVisible();
  await received.getByRole('button', { name: 'Zobraziť originál' }).click();
  await expect(received.getByText(text, { exact: true })).toBeVisible();
  await received.getByRole('button', { name: 'Zobraziť preklad' }).click();
  await expect(received.getByText(`[Slovak] ${text}`)).toBeVisible();

  // My own message offers no translation.
  const mine = admin.locator('[data-message-id]').filter({ hasText: own });
  await mine.hover();
  await expect(mine.getByRole('button', { name: 'Preložiť' })).toHaveCount(0);
});

// 2026-10-21: a foreign client also writes in a group on a .sk instance; Translate is offered
// there too.
test('a group on a .sk instance offers Translate too', async ({ page: admin, browser }) => {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await admin.request.post('/api/groups', {
    data: { name: `E2E translate sk ${stamp}`, egrantUrl: `https://e2e-trsk-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  const channel = (await (await admin.request.get(`/api/groups/${group.id}/chat`)).json()) as {
    id: string;
  };
  const emailB = `e2e-trsk-${stamp}@example.com`;
  expect(
    (
      await admin.request.post('/api/admins', { data: { email: emailB, name: `E2E Sk ${stamp}` } })
    ).ok(),
  ).toBe(true);
  const contextB = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  await logInWithCode(await contextB.newPage(), contextB.request, emailB);
  const text = `Прийшло сповіщення ${stamp}`;
  const sent = await contextB.request.post(`/api/channels/${channel.id}/messages`, {
    data: { body: text, clientId: `e2e-sk-${stamp}` },
  });
  expect(sent.status()).toBe(201);
  await contextB.close();

  await admin.goto(`/groups/${group.id}/chat`);
  const received = admin.locator('[data-message-id]').filter({ hasText: text });
  await received.hover();
  await received.getByRole('button', { name: 'Preložiť' }).click();
  await expect(received.getByText(`[Slovak] ${text}`)).toBeVisible();
});
