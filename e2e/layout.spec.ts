import { expect, test } from '@playwright/test';

// The chat card fills the window down to the page's bottom gap, at any window size, and the page
// itself never scrolls (the message list scrolls inside the card).
for (const { name, width, height, gap, mobile } of [
  { name: 'desktop 1440x900', width: 1440, height: 900, gap: 32, mobile: false },
  { name: 'laptop 1280x720', width: 1280, height: 720, gap: 32, mobile: false },
  { name: 'phone 390x844', width: 390, height: 844, gap: 12, mobile: true },
]) {
  test(`the chat fills the window height (${name})`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      reducedMotion: 'reduce',
      locale: 'sk-SK',
      storageState: 'e2e/.auth/superadmin.json',
    });
    const page = await context.newPage();
    try {
      const stamp = `${Date.now()}-${width}`; // the three run in parallel: unique group URLs
      const created = await page.request.post('/api/groups', {
        data: { name: `E2E Layout ${stamp}`, egrantUrl: `https://e2e-layout-${stamp}.egrant.sk` },
      });
      const group = (await created.json()) as { id: string };
      if (!mobile) {
        // Enough clients that the admin's sidebar is taller than the window: it must scroll
        // inside its own column, never stretch the page or the chat.
        for (let i = 0; i < 25; i++) {
          await page.request.post('/api/groups', {
            data: {
              name: `E2E Layout ${stamp} ${i}`,
              egrantUrl: `https://e2e-layout-${stamp}-${i}.egrant.sk`,
            },
          });
        }
      }
      await page.goto(`/groups/${group.id}/chat`);
      const card = page.getByTestId('chat-card');
      await expect(card.getByRole('toolbar')).toBeVisible();
      const box = (await card.boundingBox())!;
      expect(Math.round(box.y + box.height)).toBe(height - gap);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    } finally {
      await context.close();
    }
  });
}

// On a phone the sections are one menu pill with a bottom sheet; the account menu holds only the
// person's own things (Settings, the languages, Log out).
test('on a phone, the section menu moves between sections and the account menu has no sections', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    reducedMotion: 'reduce', // measured boxes: no sheet animation in flight
    hasTouch: true,
    locale: 'sk-SK',
    storageState: 'e2e/.auth/superadmin.json',
  });
  const page = await context.newPage();
  try {
    await page.goto('/settings');
    const header = page.getByRole('banner');
    // No language pill and no section links on a phone: the menu pill says where you are.
    await expect(header.getByRole('button', { name: /^Jazyk:/ })).toBeHidden();
    await expect(header.getByRole('link', { name: 'Úlohy' })).toBeHidden();
    await header.getByRole('button', { name: 'Menu', exact: true }).tap();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(sheet.getByRole('link')).toHaveText([
      'Domov',
      /^Úlohy/,
      /^Tikety/,
      'Znalosti',
      'Skupiny',
      'Administrátori',
      'Hromadné e-maily',
    ]);
    const row = (await sheet.getByRole('link').first().boundingBox())!;
    expect(row.height).toBe(48);
    await sheet.getByRole('link', { name: /^Úlohy/ }).tap();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(sheet).toHaveCount(0);
    await expect(header.getByRole('button', { name: 'Menu: Úlohy' })).toBeVisible();

    await header.getByRole('button', { name: 'Menu účtu' }).tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByRole('menuitem')).toHaveText(['Nastavenia', 'Odhlásiť sa']);
    await expect(menu.getByRole('menuitemradio', { name: 'Slovenčina' })).toBeVisible();
    // Nothing on the page is wider than the window.
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  } finally {
    await context.close();
  }
});
