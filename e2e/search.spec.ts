import { expect, test, type BrowserContext } from '@playwright/test';

// The global search and quick switcher (2026-10-18): Cmd/Ctrl+K on a computer, the header's
// search button opening a full-screen sheet on a phone; results lead to their screens.

test.describe.serial('global search', () => {
  const stamp = Date.now();
  const word = `Hľadanie${stamp}`;
  let admin: BrowserContext;
  let groupId = '';
  let taskId = '';

  test.beforeAll(async ({ browser }) => {
    admin = await browser.newContext({
      locale: 'sk-SK',
      storageState: 'e2e/.auth/superadmin.json',
    });
    const api = admin.request;
    const group = await api.post('/api/groups', {
      data: { name: `Obec ${word} Lúky`, egrantUrl: `https://e2e-search-${stamp}.egrant.sk` },
    });
    expect(group.status()).toBe(201);
    groupId = ((await group.json()) as { id: string }).id;
    const task = await api.post(`/api/groups/${groupId}/tasks`, {
      data: { title: `Rozpočet ${word}` },
    });
    expect(task.status()).toBe(201);
    taskId = ((await task.json()) as { id: string }).id;
  });
  test.afterAll(async () => {
    await admin.close();
  });

  test('Ctrl+K opens the palette; the arrows and Enter open a task', async () => {
    const page = await admin.newPage();
    await page.goto('/settings');
    await expect(page.getByRole('button', { name: 'Hľadať' })).toBeVisible();
    await page.keyboard.press('ControlOrMeta+k');
    const box = page.getByRole('combobox', { name: 'Hľadať' });
    await expect(box).toBeFocused();
    // Without diacritics: the search folds them.
    await box.fill(`hladanie${stamp}`);
    const group = page.getByRole('option', { name: new RegExp(`^Obec ${word} Lúky`) });
    await expect(group).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('ArrowDown');
    await expect(
      page.getByRole('option', { name: new RegExp(`^Rozpočet ${word}`) }),
    ).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/tasks/${taskId}$`));
    await expect(box).toHaveCount(0);
    // Back goes to where the search started, not to the palette.
    await page.goBack();
    await expect(page).toHaveURL(/\/settings$/);
    await page.close();
  });

  test('on a phone the search button opens a full-screen sheet', async ({ browser }) => {
    const phone = await browser.newContext({
      locale: 'sk-SK',
      storageState: 'e2e/.auth/superadmin.json',
      viewport: { width: 390, height: 780 },
      hasTouch: true,
    });
    const page = await phone.newPage();
    await page.goto('/');
    await page.getByRole('button', { name: 'Hľadať' }).click();
    const sheet = page.getByRole('dialog', { name: 'Hľadať' });
    await expect(sheet).toBeVisible();
    const box = await sheet.boundingBox();
    expect(box?.width).toBe(390);
    expect(box?.height).toBe(780);
    await sheet.getByRole('combobox').fill(word);
    await sheet.getByRole('option', { name: new RegExp(`^Obec ${word} Lúky`) }).click();
    await expect(page).toHaveURL(new RegExp(`/groups/${groupId}/chat$`));
    await expect(sheet).toHaveCount(0);
    await phone.close();
  });
});
