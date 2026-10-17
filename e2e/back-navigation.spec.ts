import { expect, test, type APIRequestContext } from '@playwright/test';

// Back follows docs/design/README.md, "Navigation and Back": opening is a step, switching is
// not, closing goes back, and Back closes an open layer first. The UI is Slovak in e2e.

async function groupWithTask(request: APIRequestContext, label: string) {
  const stamp = Date.now();
  const created = await request.post('/api/groups', {
    data: {
      name: `E2E Späť ${label} ${stamp}`,
      egrantUrl: `https://e2e-back-${label}-${stamp}.egrant.sk`,
    },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  const task = await request.post(`/api/groups/${group.id}/tasks`, {
    data: { title: `Späť úloha ${stamp}` },
  });
  expect(task.ok()).toBe(true);
  return { groupId: group.id, title: `Späť úloha ${stamp}` };
}

test('group tabs replace, a closed task does not come back, Back leaves the group', async ({
  page,
}) => {
  const { groupId, title } = await groupWithTask(page.request, 'tabs');
  await page.goto('/settings');
  await page.goto(`/groups/${groupId}/chat`);

  // A tab switch is no step of its own.
  await page
    .getByRole('navigation', { name: 'Časti skupiny' })
    .getByRole('link', { name: 'Úlohy' })
    .click();
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/tasks$`));

  // Opening the task is a step; closing it goes back to the board.
  await page.getByRole('link', { name: new RegExp(title) }).click();
  const panel = page.getByRole('complementary', { name: 'Úloha' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Zavrieť' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/tasks$`));

  // Back does not reopen the task, nor show the Chat tab: it leaves the group.
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
});

test('browser Back while a task is open closes it and keeps the board', async ({ page }) => {
  const { groupId, title } = await groupWithTask(page.request, 'panel');
  await page.goto(`/groups/${groupId}/tasks`);
  await page.getByRole('link', { name: new RegExp(title) }).click();
  const panel = page.getByRole('complementary', { name: 'Úloha' });
  await expect(panel).toBeVisible();
  await page.goBack();
  await expect(panel).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/tasks$`));
  await expect(page.getByRole('link', { name: new RegExp(title) })).toBeVisible();
});

test('on a phone, Back closes the section menu and stays on the page', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'sk-SK',
    storageState: 'e2e/.auth/superadmin.json',
  });
  const page = await context.newPage();
  // The open sheet's own history entry (`state.layer`, lib/use-back-closes.ts) and the entry's
  // position: the signals to wait on, instead of time.
  const entry = () =>
    page.evaluate(() => {
      const state = (window.history.state ?? {}) as { layer?: string; __TSR_index?: number };
      return { layer: state.layer ?? null, index: state.__TSR_index ?? null };
    });
  try {
    await page.goto('/tasks');
    await page.goto('/settings');
    const header = page.getByRole('banner');
    const settings = await entry();
    await header.getByRole('button', { name: 'Menu', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(sheet).toBeVisible();
    await expect.poll(async () => (await entry()).layer).not.toBeNull();
    await page.goBack();
    await expect(sheet).toHaveCount(0);
    await expect(page).toHaveURL(/\/settings$/);
    // Back took the sheet's entry away for good: no new one while it slid out.
    await expect.poll(entry).toEqual(settings);

    // A row replaces the menu's own step: Back from the section returns to the page it was
    // opened on, once.
    await header.getByRole('button', { name: 'Menu', exact: true }).tap();
    await expect.poll(async () => (await entry()).layer).not.toBeNull();
    expect((await entry()).index).toBe(settings.index! + 1);
    await sheet.getByRole('link', { name: 'Znalosti' }).tap();
    await expect(page).toHaveURL(/\/knowledge/);
    await expect(sheet).toHaveCount(0);
    expect(await entry()).toEqual({ layer: null, index: settings.index! + 1 });
    await page.goBack();
    await expect(page).toHaveURL(/\/settings$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/tasks/);
  } finally {
    await context.close();
  }
});

test('a page that needs a session replaces itself with the login: Back stays out of the app', async ({
  browser,
}) => {
  // No stored session: an explicit empty state, since the project's default would sign in.
  const context = await browser.newContext({
    locale: 'sk-SK',
    storageState: { cookies: [], origins: [] },
  });
  const page = await context.newPage();
  try {
    await page.goto('/login');
    await expect(page).toHaveURL(/\/login/);
    // The guard replaces /settings with the login, so Back goes to the login before it.
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login\?redirect=/);
    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
  } finally {
    await context.close();
  }
});
