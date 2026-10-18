import { expect, test } from '@playwright/test';
import { phoneNavigation } from './phone-nav';

// The chat card fills the window down to the page's bottom gap, at any window size, and the page
// itself never scrolls (the message list scrolls inside the card). On a phone it runs in both
// navigation modes: Classic (the default, no bar) and the bottom bar the card must clear.
for (const { name, width, height, gap, mobile, bottomBar } of [
  { name: 'desktop 1440x900', width: 1440, height: 900, gap: 32, mobile: false, bottomBar: false },
  { name: 'laptop 1280x720', width: 1280, height: 720, gap: 32, mobile: false, bottomBar: false },
  { name: 'phone 390x844', width: 390, height: 844, gap: 12, mobile: true, bottomBar: false },
  {
    name: 'phone 390x844, bottom bar',
    width: 390,
    height: 844,
    gap: 12,
    mobile: true,
    bottomBar: true,
  },
]) {
  test(`the chat fills the window height (${name})`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: { width, height },
      isMobile: mobile,
      reducedMotion: 'reduce',
      locale: 'sk-SK',
      storageState: 'e2e/.auth/superadmin.json',
    });
    if (bottomBar) await phoneNavigation(context, 'bottom');
    const page = await context.newPage();
    try {
      const stamp = `${Date.now()}-${width}-${bottomBar}`; // they run in parallel: unique group URLs
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
      // On a phone the bottom bar floats over the window's foot: the card ends one gap above it.
      const bar = bottomBar
        ? await page.getByRole('navigation', { name: 'Hlavná navigácia' }).boundingBox()
        : null;
      expect(Math.round(box.y + box.height)).toBe(bar ? Math.round(bar.y) - gap : height - gap);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    } finally {
      await context.close();
    }
  });
}

// With the "Bottom bar" phone navigation an admin's sections are a bar (four and "Viac", whose sheet holds the
// rest); the account menu holds only the person's own things (Settings, the languages, Log out).
test('on a phone, the bottom bar moves between sections and the account menu has no sections', async ({
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
  await phoneNavigation(context, 'bottom');
  const page = await context.newPage();
  try {
    await page.goto('/settings');
    const header = page.getByRole('banner');
    // No language pill, no section links and no menu pill in the header on a phone.
    await expect(header.getByRole('button', { name: /^Jazyk:/ })).toBeHidden();
    await expect(header.getByRole('link', { name: 'Úlohy' })).toBeHidden();
    await expect(header.getByRole('button', { name: 'Menu', exact: true })).toBeHidden();
    const bar = page.getByRole('navigation', { name: 'Hlavná navigácia' });
    await expect(bar.getByRole('link')).toHaveText(['Domov', 'Skupiny', /^Úlohy/, /^Tikety/]);
    // Every item is a tap area of at least 44 px.
    for (const item of await bar.getByRole('link').all()) {
      expect((await item.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await bar.getByRole('button', { name: 'Viac' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Menu' });
    await expect(sheet.getByRole('link')).toHaveText([
      'Znalosti',
      'Financie',
      'Administrátori',
      'Hromadné e-maily',
    ]);
    const row = (await sheet.getByRole('link').first().boundingBox())!;
    expect(row.height).toBe(48);
    await sheet.getByRole('link', { name: 'Znalosti' }).tap();
    await expect(page).toHaveURL(/\/knowledge/);
    await expect(sheet).toHaveCount(0);
    await bar.getByRole('link', { name: /^Úlohy/ }).tap();
    await expect(page).toHaveURL(/\/tasks/);
    await expect(bar.getByRole('link', { name: /^Úlohy/ })).toHaveAttribute('aria-current', 'page');

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
