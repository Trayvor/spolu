import { expect, test } from '@playwright/test';

// The browser locale is sk-SK (playwright.config.ts), so the first visit renders Slovak.
test('settings shows database OK and realtime connected', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText('Databáza: OK')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Realtime: pripojené')).toBeVisible({ timeout: 10_000 });
});

test('switching to English changes the UI and persists after reload', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByText('Stav systému')).toBeVisible();
  await page.getByRole('button', { name: /Jazyk/ }).click();
  await page.getByRole('menuitemradio', { name: 'English' }).click();
  await expect(page.getByText('System status')).toBeVisible();
  await expect(page.getByText('Stav systému')).toHaveCount(0);

  await page.reload();
  await expect(page.getByText('System status')).toBeVisible();
  await expect(page.getByRole('button', { name: /Language/ })).toHaveText('EN');
  await page.getByRole('button', { name: /Language/ }).click();
  await expect(page.getByRole('menuitemradio', { name: 'English' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('the home page sends an admin to /groups', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/groups$/);
  await expect(page.getByRole('heading', { name: 'Skupiny' })).toBeVisible();
});

test('a deep link renders the app, not a server 404', async ({ page }) => {
  const response = await page.goto('/settings');
  expect(response?.status()).toBe(200);
  await expect(page.getByRole('link', { name: 'Spolu by eGrant' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Jazyk/ })).toBeVisible();
});

test('the web manifest is served with the product name', async ({ request }) => {
  const response = await request.get('/manifest.webmanifest');
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { name: string };
  expect(manifest.name).toBe('Spolu by eGrant');
});
