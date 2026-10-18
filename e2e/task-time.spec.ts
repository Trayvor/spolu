import { expect, test, type APIRequestContext, type BrowserContext } from '@playwright/test';
import type { TaskDetailDto } from '@spolu/shared';
import { clearMailFor, latestLoginCode } from './mailpit';

// Phase 32 part A2, spec §14 scenarios 3 and 5: time on done. The superadmin (A) and a new admin
// (B) manage a client and are both assignees of its task, with a client (C). A ticks the done
// circle and is asked; B is asked by a dashboard row until they fill 0. A client completing a
// task never sees the dialog. Reopening drops B's request; completing again asks again.

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

test.describe.serial('time on done', () => {
  const stamp = Date.now();
  const bName = `E2E Čas Admin ${stamp}`;
  const bEmail = `e2e-time-b-${stamp}@example.com`;
  const clientEmail = `e2e-time-c-${stamp}@example.com`;
  let groupId = '';
  let ids = { a: '', b: '', c: '' };
  let aContext: BrowserContext;
  let bContext: BrowserContext;
  let cContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    aContext = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const created = await aContext.request.post('/api/groups', {
      data: { name: `E2E Čas ${stamp}`, egrantUrl: `https://e2e-time-${stamp}.egrant.sk` },
    });
    expect(created.status()).toBe(201);
    const group = (await created.json()) as { id: string; inviteUrl: string };
    groupId = group.id;
    expect(
      (await aContext.request.post('/api/admins', { data: { name: bName, email: bEmail } })).ok(),
    ).toBe(true);
    bContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
    cContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
    await signIn(bContext.request, bEmail);
    // Admins are pickable assignees of the clients they manage.
    expect((await aContext.request.put(`/api/groups/${groupId}/managers/me`)).ok()).toBe(true);
    expect((await bContext.request.put(`/api/groups/${groupId}/managers/me`)).ok()).toBe(true);
    const token = new URL(group.inviteUrl).pathname.split('/').pop();
    expect(
      (await cContext.request.post(`/api/join/${token}`, { data: { email: clientEmail } })).ok(),
    ).toBe(true);
    await signIn(cContext.request, clientEmail);
    expect(
      (await cContext.request.patch('/api/me', { data: { name: `E2E Klient ${stamp}` } })).ok(),
    ).toBe(true);
    const me = async (context: BrowserContext) =>
      ((await (await context.request.get('/api/me')).json()) as { id: string }).id;
    ids = { a: await me(aContext), b: await me(bContext), c: await me(cContext) };
  });

  test.afterAll(async () => {
    await cContext?.close();
    await bContext?.close();
    await aContext?.close();
  });

  const newTask = async (title: string) => {
    const res = await aContext.request.post(`/api/groups/${groupId}/tasks`, {
      data: { title, assigneeIds: [ids.a, ids.b, ids.c] },
    });
    expect(res.status()).toBe(201);
    return (await res.json()) as TaskDetailDto;
  };

  test('scenario 3: A is asked by the dialog, B by the dashboard row until they fill 0', async () => {
    const title = `Rozpočet ${stamp}`;
    const task = await newTask(title);

    const a = await aContext.newPage();
    await a.goto(`/groups/${groupId}/tasks/${task.id}`);
    const panel = a.getByRole('complementary', { name: 'Úloha' });
    await panel.getByRole('button', { name: 'Označiť ako hotovú' }).click();
    const dialog = a.getByTestId('time-dialog');
    await expect(
      dialog.getByRole('heading', { name: 'Koľko času ste na tom strávili?' }),
    ).toBeVisible();
    await dialog.getByLabel('Strávený čas').fill('1:30');
    await expect(dialog.getByText('To je 1 h 30 min')).toBeVisible();
    await dialog.getByRole('button', { name: 'Uložiť' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByTestId('my-time')).toContainText('1 h 30 min');

    // B: the "Record your time" row on My tasks; a click opens the dialog in place.
    const b = await bContext.newPage();
    await b.goto('/');
    const row = b.getByRole('button', { name: `Zapíšte strávený čas: ${title}` });
    await expect(row).toBeVisible();
    await row.click();
    const bDialog = b.getByTestId('time-dialog');
    await bDialog.getByRole('button', { name: 'Žiadny čas' }).click();
    await bDialog.getByRole('button', { name: 'Uložiť' }).click();
    await expect(bDialog).toHaveCount(0);
    await expect(row).toHaveCount(0);
    await expect(b).toHaveURL(/\/$/);

    // A client completing a task never sees the dialog.
    const other = await newTask(`Klientova úloha ${stamp}`);
    const c = await cContext.newPage();
    await c.goto(`/groups/${groupId}/tasks/${other.id}`);
    await c
      .getByRole('complementary', { name: 'Úloha' })
      .getByRole('button', { name: 'Označiť ako hotovú' })
      .click();
    await expect(
      c.getByRole('complementary', { name: 'Úloha' }).getByRole('button', {
        name: 'Označiť ako nehotovú',
      }),
    ).toBeVisible();
    await expect(c.getByTestId('time-dialog')).toHaveCount(0);
  });

  test('scenario 5: reopening drops the request; completing again asks again', async () => {
    const title = `Znova otvorená ${stamp}`;
    const task = await newTask(title);
    const board = await aContext.request.get(`/api/groups/${groupId}/board`);
    const buckets = ((await board.json()) as { buckets: { id: string; kind: string }[] }).buckets;
    const bucket = (kind: string) => buckets.find((x) => x.kind === kind)!.id;
    const move = (kind: string) =>
      aContext.request.post(`/api/tasks/${task.id}/move`, {
        data: { bucketId: bucket(kind), afterTaskId: null },
      });

    expect((await (await move('done')).json()) as { askTime: boolean }).toMatchObject({
      askTime: true,
    });
    const b = await bContext.newPage();
    await b.goto('/');
    const row = b.getByRole('button', { name: `Zapíšte strávený čas: ${title}` });
    await expect(row).toBeVisible();

    expect((await move('todo')).ok()).toBe(true);
    // Live: `time:requests` refetches the card.
    await expect(row).toHaveCount(0);

    expect((await move('done')).ok()).toBe(true);
    await expect(row).toBeVisible();
  });
});
