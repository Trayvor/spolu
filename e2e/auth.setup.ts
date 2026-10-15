import { test as setup } from '@playwright/test';
import { logInWithCode } from './login';

export const SUPERADMIN_EMAIL = 'admin@example.com';
export const SUPERADMIN_STATE = 'e2e/.auth/superadmin.json';

// Logs the e2e superadmin in once; the chromium project reuses the saved state.
setup('log in the superadmin', async ({ page, request }) => {
  await logInWithCode(page, request, SUPERADMIN_EMAIL);
  await page.context().storageState({ path: SUPERADMIN_STATE });
});
