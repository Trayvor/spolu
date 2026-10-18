import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { clearMailFor, latestLoginCode, subjectsFor } from './mailpit';
import { fakeSubscription, pushesFor, waitForPush } from './push-log';

// One client logs in once (production rate limits allow only a few code requests per minute).
test('the client switches the bell to Mentions and replies and it sticks after reload', async ({
  page: admin,
  browser,
}) => {
  const stamp = Date.now();
  const email = `e2e-bell-${stamp}@example.com`;

  await admin.goto('/groups');
  await admin.getByRole('button', { name: 'Vytvoriť skupinu' }).first().click();
  await admin.getByLabel('Názov').fill(`E2E Bell ${stamp}`);
  await admin.getByLabel('Adresa klienta v eGrante').fill(`https://e2e-bell-${stamp}.egrant.sk`);
  await admin.getByRole('button', { name: 'Uložiť' }).click();
  await expect(admin.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
  // The Groups page draws 50 rows at a time: find the group by name first.
  await admin.getByRole('searchbox', { name: 'Nájsť skupinu' }).fill(`E2E Bell ${stamp}`);
  // The groups list's row, not the admin sidebar's link (it may list the new group too).
  await admin
    .locator('a[href^="/groups/"]:not([href$="/chat"])', { hasText: `E2E Bell ${stamp}` })
    .click();
  const groupPath = new URL(admin.url()).pathname.replace(/\/chat$/, '');
  await admin.goto(`${groupPath}/members`);
  const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();

  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await context.newPage();
  await client.goto(new URL(inviteUrl).pathname);
  await clearMailFor(context.request, email);
  await client.getByLabel('E-mail').fill(email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await client.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await client.getByLabel('Vaše meno').fill('E2E Bell Client');
  await client.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(client).toHaveURL(new RegExp(`${groupPath}/chat$`));

  // A client starts on "All messages".
  await client.getByRole('button', { name: 'Upozornenia: Všetky správy' }).click();
  await client.getByRole('menuitemradio', { name: /Zmienky a odpovede/ }).click();
  await expect(
    client.getByRole('button', { name: 'Upozornenia: Zmienky a odpovede' }),
  ).toBeVisible();

  await client.reload();
  await expect(
    client.getByRole('button', { name: 'Upozornenia: Zmienky a odpovede' }),
  ).toBeVisible();
  await context.close();
});

// Push delivery by group mode, then the email digest. The e2e server runs the fake sender, which
// appends every send to a file. One client logs in once for all three tests; the digest test runs
// last, so its messages do not queue in front of the push tests' deliveries.
test.describe.serial('push and email delivery', () => {
  let groupId = '';
  let channelId = '';
  let clientId = '';
  let clientEmail = '';
  let clientContext: BrowserContext;
  let adminContext: BrowserContext;
  const endpoint = fakeSubscription();

  test.beforeAll(async ({ browser }) => {
    const stamp = Date.now();
    const email = `e2e-push-${stamp}@example.com`;
    clientEmail = email;
    adminContext = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const created = await adminContext.request.post('/api/groups', {
      data: { name: `E2E Push ${stamp}`, egrantUrl: `https://e2e-push-${stamp}.egrant.sk` },
    });
    groupId = ((await created.json()) as { id: string }).id;
    channelId = (
      (await (await adminContext.request.get(`/api/groups/${groupId}/chat`)).json()) as {
        id: string;
      }
    ).id;

    const admin = await adminContext.newPage();
    await admin.goto(`/groups/${groupId}/members`);
    const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();

    clientContext = await browser.newContext({
      locale: 'sk-SK',
      storageState: undefined,
      permissions: ['notifications'],
    });
    const client = await clientContext.newPage();
    await client.goto(new URL(inviteUrl).pathname);
    await clearMailFor(clientContext.request, email);
    await client.getByLabel('E-mail').fill(email);
    await client.getByRole('button', { name: 'Poslať kód' }).click();
    await client.getByLabel('Kód').fill(await latestLoginCode(clientContext.request, email));
    await client.getByLabel('Vaše meno').fill('E2E Push Client');
    await client.getByRole('button', { name: 'Pokračovať' }).click();
    await expect(client).toHaveURL(new RegExp(`/groups/${groupId}/chat$`));

    clientId = ((await (await client.request.get('/api/me')).json()) as { id: string }).id;
    const saved = await client.request.post('/api/push/subscriptions', { data: endpoint });
    expect(saved.status()).toBe(204);
    // An open chat marks messages read at once, and a read message sends no push.
    await client.close();
  });

  test.afterAll(async () => {
    await clientContext?.close();
    await adminContext?.close();
  });

  const send = async (body: string) => {
    const res = await adminContext.request.post(`/api/channels/${channelId}/messages`, {
      data: { body, clientId: randomUUID() },
    });
    expect(res.status()).toBe(201);
  };

  test('a client in mode All gets a push for an admin message', async () => {
    const text = `plain-all-${Date.now()}`;
    await send(text);
    const push = await waitForPush(endpoint.endpoint, (p) => p.body.includes(text));
    expect(push.url.startsWith(`/groups/${groupId}/chat?message=`)).toBe(true);
  });

  test('in Mentions and replies the client gets none for a plain message but one for an @mention', async () => {
    const set = await clientContext.request.put(`/api/groups/${groupId}/notification-mode`, {
      data: { mode: 'mentions' },
    });
    expect(set.status()).toBe(204);

    const plain = `plain-mode-${Date.now()}`;
    const mention = `mention-${Date.now()}`;
    await send(plain);
    await send(`<@${clientId}> ${mention}`);
    await waitForPush(endpoint.endpoint, (p) => p.body.includes(mention));
    expect(pushesFor(endpoint.endpoint).some((p) => p.body.includes(plain))).toBe(false);
  });

  // The e2e server batches email after EMAIL_BATCH_DELAY_MS (10 s) instead of 10 minutes: long
  // enough that all three messages are delivered before the batch is emailed.
  test('with chat on email, one batched email arrives in Mailpit', async () => {
    test.setTimeout(60_000); // a 30 s poll for the email, then 5 s to see no second one
    // Back to All messages: the test above left the client on Mentions and replies.
    const reset = await clientContext.request.put(`/api/groups/${groupId}/notification-mode`, {
      data: { mode: 'all' },
    });
    expect(reset.status()).toBe(204);

    // The settings page, not the chat: an open chat would mark the messages read.
    const client = await clientContext.newPage();
    await client.goto('/settings');
    // Chat on "E-mail" in the notification groups (the e2e server has no VAPID key, so the push
    // choices are disabled in the page; the fake sender still records the API's subscriptions).
    const chat = client.getByRole('combobox', { name: 'Chat' });
    await expect(chat).toHaveValue('push');
    const saved = client.waitForResponse(
      (r) => r.url().endsWith('/api/notifications/preferences') && r.request().method() === 'PATCH',
    );
    await chat.selectOption('email');
    expect((await saved).status()).toBe(200);
    await expect(chat).toHaveValue('email');
    await clearMailFor(clientContext.request, clientEmail);

    const stamp = Date.now();
    for (const n of [1, 2, 3]) await send(`digest ${n} ${stamp}`);

    await expect
      .poll(() => subjectsFor(clientContext.request, clientEmail), { timeout: 30_000 })
      .toHaveLength(1);
    const [subject] = await subjectsFor(clientContext.request, clientEmail);
    expect(subject).toContain('3 nové správy');
    // No second email for the same messages.
    await client.waitForTimeout(5_000);
    expect(await subjectsFor(clientContext.request, clientEmail)).toHaveLength(1);
    await client.close();
  });
});
