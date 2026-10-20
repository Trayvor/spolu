import { createRequire } from 'node:module';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { groupsFind } from './groups-find';
import { setEditorText } from './editor';
import { clearMailFor, latestLoginCode } from './mailpit';

// `postgres` is a dependency of the server package, not of the repo root.
const postgres = createRequire(import.meta.dirname + '/../apps/server/package.json')('postgres');

/** Log in through the API with an emailed code: production rate limits allow few UI code requests. */
async function signIn(request: APIRequestContext, email: string) {
  await clearMailFor(request, email);
  const sent = await request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email, type: 'sign-in' },
  });
  expect(sent.ok()).toBe(true);
  const otp = await latestLoginCode(request, email);
  expect((await request.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(
    true,
  );
}

// Two admins (the stored superadmin A and a new admin B) and a client, in three browser contexts.
test('admin A manages a client; pickers, @all and live updates follow', async ({
  page: a,
  browser,
}) => {
  // The repeat index keeps `--repeat-each` copies, started in the same millisecond, apart.
  const stamp = `${Date.now()}-${test.info().repeatEachIndex}`;
  const groupName = `E2E Managers ${stamp}`;
  const bEmail = `e2e-mgr-b-${stamp}@example.com`;
  const bName = `E2E Admin B ${stamp}`;
  const clientEmail = `e2e-mgr-client-${stamp}@example.com`;
  const clientName = `E2E Klient ${stamp}`;
  const databaseUrl = process.env.DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_e2e';
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });

  const aId = ((await (await a.request.get('/api/me')).json()) as { id: string; name: string }).id;
  const aName = ((await (await a.request.get('/api/me')).json()) as { name: string }).name;

  // Setup through the API: a group, admin B, a client who joined.
  const created = await a.request.post('/api/groups', {
    data: { name: groupName, egrantUrl: `https://e2e-mgr-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const token = new URL(group.inviteUrl).pathname.split('/').pop();
  const added = await a.request.post('/api/admins', { data: { name: bName, email: bEmail } });
  expect(added.ok()).toBe(true);

  const bContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const cContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  try {
    await signIn(bContext.request, bEmail);
    const bId = ((await (await bContext.request.get('/api/me')).json()) as { id: string }).id;
    expect(
      (await cContext.request.post(`/api/join/${token}`, { data: { email: clientEmail } })).ok(),
    ).toBe(true);
    await signIn(cContext.request, clientEmail);
    expect((await cContext.request.patch('/api/me', { data: { name: clientName } })).ok()).toBe(
      true,
    );

    // A task assigned to B before A manages: B is a manager just long enough to be assigned,
    // then stops. The assignment stays.
    expect((await bContext.request.put(`/api/groups/${group.id}/managers/me`)).ok()).toBe(true);
    const task = await bContext.request.post(`/api/groups/${group.id}/tasks`, {
      data: { title: 'Zostane na B', assigneeIds: [bId] },
    });
    expect(task.status()).toBe(201);
    expect((await bContext.request.delete(`/api/groups/${group.id}/managers/me`)).ok()).toBe(true);

    // 1. A opens Groups and clicks Manage on the group.
    await a.goto('/groups');
    // The Groups page draws 50 rows at a time: find the group by name first.
    await groupsFind(a).fill(groupName);
    const manage = a.getByRole('button', { name: `Spravovať ${groupName}` });
    await expect(manage).toBeVisible();
    await expect(manage).toHaveText('Spravovať');
    await manage.click();
    await expect(manage).toHaveText('Spravujem');
    await expect(manage).toHaveAttribute('aria-pressed', 'true');
    await a.goto(`/groups/${group.id}/chat`);
    await expect(a.getByRole('button', { name: 'Upozornenia: Všetky správy' })).toBeVisible();

    // 2. B (not a manager) types @: the picker shows the client and A, not B.
    const b = await bContext.newPage();
    await b.goto(`/groups/${group.id}/chat`);
    const bBox = b.getByRole('textbox', { name: 'Napíšte správu…' });
    await bBox.fill('@');
    const bPicker = b.getByRole('listbox', { name: 'Ľudia' });
    await expect(bPicker.getByRole('option', { name: new RegExp(clientName) })).toBeVisible();
    await expect(bPicker.getByRole('option', { name: aName })).toBeVisible();
    await expect(bPicker.getByRole('option', { name: new RegExp(bName) })).toHaveCount(0);

    // 3. B sends @all: A is notified, B is not.
    const text = `@all hotovo ${stamp}`;
    await setEditorText(bBox, text);
    await bBox.press('Enter');
    await expect(
      b.locator('[data-message-id]').filter({ hasText: `hotovo ${stamp}` }),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const rows = await sql`select 1 from notification_events
          where group_id = ${group.id} and user_id = ${aId} and kind = 'chat.mention'`;
        return rows.length;
      })
      .toBe(1);
    const forB = await sql`select 1 from notification_events
      where group_id = ${group.id} and user_id = ${bId} and kind = 'chat.mention'`;
    expect(forB.length).toBe(0);

    // 4. The client has the chat open; A stops managing; the picker loses A without a reload.
    const client = await cContext.newPage();
    await client.goto(`/groups/${group.id}/chat`);
    const cBox = client.getByRole('textbox', { name: 'Napíšte správu…' });
    await cBox.fill('@');
    const cPicker = client.getByRole('listbox', { name: 'Ľudia' });
    await expect(cPicker.getByRole('option', { name: aName })).toBeVisible();
    await setEditorText(cBox, '');
    await expect(cPicker).toHaveCount(0);

    await a.goto('/groups');
    await groupsFind(a).fill(groupName);
    await expect(manage).toHaveText('Spravujem');
    await manage.click();
    await expect(manage).toHaveText('Spravovať');
    await expect
      .poll(
        async () => {
          await setEditorText(cBox, '@');
          return cPicker.getByRole('option', { name: aName }).count();
        },
        { timeout: 15_000 },
      )
      .toBe(0);

    // 5. The task assigned to B still shows B on the board.
    await a.goto(`/groups/${group.id}/tasks`);
    await expect(a.getByRole('link', { name: /Zostane na B/ })).toContainText(bName);

    // 6. (2026-10-18) An admin assigns an admin who does not manage the client: A offers B
    // under "Ostatní administrátori", marked; the client still cannot assign B.
    await a.goto(`/groups/${group.id}/tasks/new`);
    await a.getByRole('combobox', { name: 'Riešitelia' }).fill(bName);
    const assignees = a.getByRole('listbox', { name: 'Riešitelia' });
    await expect(assignees.getByText('Ostatní administrátori')).toBeVisible();
    await expect(
      assignees.getByRole('option', { name: new RegExp(`${bName}.*nie je garant`) }),
    ).toBeVisible();
    const byAdmin = await a.request.post(`/api/groups/${group.id}/tasks`, {
      data: { title: 'Pre B od admina', assigneeIds: [bId] },
    });
    expect(byAdmin.status()).toBe(201);
    const byClient = await cContext.request.post(`/api/groups/${group.id}/tasks`, {
      data: { title: 'Pre B od klienta', assigneeIds: [bId] },
    });
    expect(byClient.status()).toBe(400);
  } finally {
    await sql.end();
    await bContext.close();
    await cContext.close();
  }
});

// Phase 22a: any admin sets another admin as a group's manager on the Members tab.
test('admin A adds and removes admin B as a manager on the Members tab', async ({ page: a }) => {
  const stamp = Date.now();
  const groupName = `E2E Members Managers ${stamp}`;
  const bName = `E2E Admin Mgr ${stamp}`;
  const bEmail = `e2e-members-mgr-${stamp}@example.com`;

  const created = await a.request.post('/api/groups', {
    data: { name: groupName, egrantUrl: `https://e2e-members-mgr-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  expect((await a.request.post('/api/admins', { data: { name: bName, email: bEmail } })).ok()).toBe(
    true,
  );

  // 1. A adds B from "+ Pridať garanta".
  await a.goto(`/groups/${group.id}/members`);
  await a.getByRole('button', { name: 'Pridať garanta' }).click();
  const menu = a.getByRole('menu');
  // Earlier runs leave many admins behind: the menu then has a find field.
  const find = menu.getByRole('searchbox', { name: 'Nájsť administrátora' });
  if (await find.isVisible()) await find.fill(bName);
  await menu.getByRole('menuitem', { name: bName }).click();
  const managers = a.getByRole('list', { name: 'Garanti z eGrantu' });
  await expect(managers.getByText(bName)).toBeVisible();

  // 2. B shows in the group's avatars on the Groups page, by name in the tooltip.
  await a.goto('/groups');
  // The Groups page draws 50 rows at a time: find the group by name first.
  await groupsFind(a).fill(groupName);
  const avatars = a.getByRole('button', { name: `Garanti klienta ${groupName}` });
  await avatars.scrollIntoViewIfNeeded();
  await avatars.hover();
  await expect(a.locator('[data-manager-tooltip]')).toContainText(bName);

  // 3. A removes B on the Members tab; the Groups page has no avatars for the group any more.
  await a.goto(`/groups/${group.id}/members`);
  await a.getByRole('button', { name: `Odobrať ${bName}` }).click();
  await expect(a.getByText('Zatiaľ žiadny garant z eGrantu.')).toBeVisible();
  await a.goto('/groups');
  await groupsFind(a).fill(groupName);
  await expect(a.getByRole('button', { name: `Spravovať ${groupName}` })).toBeVisible();
  await expect(a.getByRole('button', { name: `Garanti klienta ${groupName}` })).toHaveCount(0);
});
