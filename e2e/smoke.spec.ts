import { expect, test } from '@playwright/test';

// The browser locale is sk-SK (playwright.config.ts), so the first visit renders Slovak.
test('home shows database OK and realtime connected', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Databáza: OK')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Realtime: pripojené')).toBeVisible({ timeout: 10_000 });
});

test('switching to English changes the UI and persists after reload', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Stav systému')).toBeVisible();
  await page.getByRole('radio', { name: 'English' }).click();
  await expect(page.getByText('System status')).toBeVisible();
  await expect(page.getByText('Stav systému')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('System status')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('a deep link renders the app, not a server 404', async ({ page }) => {
  const response = await page.goto('/settings');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('radiogroup')).toBeVisible();
});

test('the web manifest is served with the product name', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { name: string };
  expect(manifest.name).toBe('Spolu by eGrant');
});
