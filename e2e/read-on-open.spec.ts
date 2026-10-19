import { expect, test, type APIRequestContext } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

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

const unreadOf = async (request: APIRequestContext) =>
  ((await (await request.get('/api/me/notifications/state')).json()) as { unread: number }).unread;

// Read on open (2026-10-19, ADR 0060): a task assigned to a new admin N notifies them; opening it
// from the group's board (not from the notification) reads that notification: the bell's count
// drops and the card's mark goes, live. The stored superadmin only sets things up.
test('opening a task from the board reads its notification: the bell drops, the mark goes', async ({
  page: setup,
  browser,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const email = `e2e-read-open-${stamp}@example.com`;
  const created = await setup.request.post('/api/groups', {
    data: { name: `E2E Prečítané ${stamp}`, egrantUrl: `https://e2e-read-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  expect(
    (await setup.request.post('/api/admins', { data: { name: `Nela ${stamp}`, email } })).ok(),
  ).toBe(true);

  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  try {
    await signIn(context.request, email);
    const nId = ((await (await context.request.get('/api/me')).json()) as { id: string }).id;
    expect((await context.request.put(`/api/groups/${group.id}/managers/me`)).ok()).toBe(true);
    const before = await unreadOf(context.request);

    const task = await setup.request.post(`/api/groups/${group.id}/tasks`, {
      data: { title: `Prečítaj ma ${stamp}`, assigneeIds: [nId] },
    });
    expect(task.status()).toBe(201);
    const taskId = ((await task.json()) as { id: string }).id;
    // The delivery worker puts the assignment into N's centre.
    await expect.poll(() => unreadOf(context.request), { timeout: 15_000 }).toBe(before + 1);

    const n = await context.newPage();
    await n.goto(`/groups/${group.id}/tasks`);
    const label = (count: number) =>
      count > 0 ? `Upozornenia, neprečítané: ${count}` : 'Upozornenia';
    await expect(n.getByRole('button', { name: label(before + 1), exact: true })).toBeVisible();
    const card = n.locator(`[data-task-id="${taskId}"]`);
    const marker = card.getByRole('button', { name: 'Nová zmena' });
    await expect(marker).toBeVisible();

    const seen = n.waitForResponse(
      (r) => r.request().method() === 'POST' && r.url().endsWith(`/api/tasks/${taskId}/seen`),
    );
    await card.getByRole('link', { name: new RegExp(`Prečítaj ma ${stamp}`) }).click();
    expect((await seen).status()).toBe(204);
    // The bell refetches on `notifications:read`; the board's marks after their 2 s debounce.
    await expect(n.getByRole('button', { name: label(before), exact: true })).toBeVisible({
      timeout: 15_000,
    });
    expect(await unreadOf(context.request)).toBe(before);
    await n.keyboard.press('Escape');
    await expect(marker).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await context.close();
  }
});
