import { expect, test, type Page } from '@playwright/test';

// The e2e server runs with WHATS_NEW=off (a popup would cover every other spec), so this spec
// answers `GET /api/me/announcement` itself; marking it seen goes to the real server.

async function announce(page: Page) {
  await page.route('**/api/me/announcement', (route) =>
    route.fulfill({
      json: {
        announcement: {
          id: '2026-10-21',
          sections: ['taskSplit', 'snippets', 'bulkEmail', 'finance'],
        },
      },
    }),
  );
  const seen = page.waitForResponse(
    (res) =>
      res.request().method() === 'POST' &&
      res.url().endsWith('/api/me/announcement/2026-10-21/seen'),
  );
  return seen;
}

test('"What\'s new" shows on the landing screen and "Rozumiem" marks it seen', async ({ page }) => {
  const seen = await announce(page);
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Novinky v Help' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { level: 3 })).toHaveText([
    'Úlohy z textu pomocou AI',
    'Uložené odpovede cez lomku',
    'Kontajner v hromadných e-mailoch',
    'Mzdy a zmluvy vo Financiách',
  ]);
  await dialog.getByRole('button', { name: 'Rozumiem' }).click();
  expect((await seen).status()).toBe(204);
  await expect(dialog).toBeHidden();
});

test('a section link closes "What\'s new" and opens its screen', async ({ page }) => {
  const seen = await announce(page);
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'Novinky v Help' });
  await dialog.getByRole('link', { name: 'Otvoriť Financie' }).click();
  expect((await seen).status()).toBe(204);
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/\/finance/);
});
