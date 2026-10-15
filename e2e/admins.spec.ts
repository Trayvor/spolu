import { expect, test } from '@playwright/test';
import { logInWithCode } from './login';

test('an anonymous visitor is sent to /login', async ({ browser }) => {
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const page = await context.newPage();
  await page.goto('/admins');
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole('button', { name: 'Poslať kód' })).toBeVisible();
  await context.close();
});

// One serial flow: production rate limits allow only a few code requests per minute.
test('superadmin adds an admin, who logs in and sees the list, then is removed', async ({
  page,
  browser,
}) => {
  const name = `E2E Admin ${Date.now()}`;
  const email = `e2e-${Date.now()}@example.com`;

  await page.goto('/admins');
  await expect(page.getByRole('heading', { name: 'Administrátori' })).toBeVisible();
  await page.getByRole('button', { name: 'Pridať administrátora' }).click();
  await page.getByLabel('Meno').fill(name);
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Pridať a poslať e-mail' }).click();
  await expect(page.getByText(email)).toBeVisible();

  // The new admin logs in in a second, separate browser context.
  const adminContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const adminPage = await adminContext.newPage();
  await logInWithCode(adminPage, adminContext.request, email);
  await adminPage.goto('/admins');
  await expect(adminPage.getByRole('heading', { name: 'Administrátori' })).toBeVisible();
  await expect(adminPage.getByText(email)).toBeVisible();
  await expect(adminPage.getByText('admin@example.com')).toBeVisible();

  // The superadmin removes them (two clicks: Remove, then confirm).
  await page
    .getByRole('listitem')
    .filter({ hasText: email })
    .getByRole('button', { name: 'Odobrať' })
    .click();
  // The row now asks "Odobrať <name>?" and no longer shows the email.
  await page
    .getByRole('listitem')
    .filter({ hasText: name })
    .getByRole('button', { name: 'Odobrať' })
    .click();
  await expect(page.getByText(email)).toHaveCount(0);

  // The removed admin loses access at once: the next navigation lands on /login.
  await adminPage.goto('/');
  await expect(adminPage).toHaveURL(/\/login/);
  await adminContext.close();

  // The superadmin logs out through the user menu (no extra code needed).
  await page.getByRole('button', { name: 'Menu účtu' }).click();
  await page.getByRole('menuitem', { name: 'Odhlásiť sa' }).click();
  await expect(page).toHaveURL(/\/login/);
});
