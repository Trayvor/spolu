import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

/** Log in through the UI with an emailed code (the UI is Slovak in e2e). */
export async function logInWithCode(page: Page, request: APIRequestContext, email: string) {
  await clearMailFor(request, email);
  await page.goto('/login');
  await page.getByLabel('E-mail').fill(email);
  await page.getByRole('button', { name: 'Poslať kód' }).click();
  await expect(page.getByLabel('Kód')).toBeVisible();
  await page.getByLabel('Kód').fill(await latestLoginCode(request, email));
  // The sixth digit submits the code by itself.
  await expect(page).not.toHaveURL(/\/login/);
}
