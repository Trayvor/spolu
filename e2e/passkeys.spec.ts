import { expect, test } from '@playwright/test';
import { waitForMessage } from './mailpit';
import { logInWithCode } from './login';

// Admin passkeys (ADR 0050) with Chromium's virtual authenticator (CDP WebAuthn domain): a
// platform authenticator with discoverable credentials and user verification that answers on
// its own, as a fingerprint would. The authenticator belongs to this one tab, so the whole flow
// runs in one page.
test('an admin adds a passkey in Settings and logs in with it', async ({ page, browser }) => {
  const stamp = Date.now();
  const email = `e2e-passkey-${stamp}@example.com`;
  const added = await page.request.post('/api/admins', {
    data: { email, name: `E2E Passkey ${stamp}` },
  });
  expect(added.ok()).toBe(true);

  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const admin = await context.newPage();
  const cdp = await context.newCDPSession(admin);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });

  // Just logged in with the code: a fresh session adds a passkey without the re-check code.
  await logInWithCode(admin, context.request, email);
  await admin.goto('/settings');
  await expect(admin.getByRole('heading', { name: 'Kľúče (passkeys)' })).toBeVisible();
  await expect(admin.getByText('Zatiaľ nemáte žiadny kľúč.')).toBeVisible();
  await admin.getByPlaceholder('Pracovný notebook').fill('E2E kľúč');
  await admin.getByRole('button', { name: 'Pridať kľúč' }).click();
  await expect(admin.getByText('Kľúč bol pridaný.')).toBeVisible();
  await expect(admin.getByText('E2E kľúč')).toBeVisible();
  await expect(admin.getByText('Zatiaľ nepoužitý')).toBeVisible();

  // The security notice reaches the admin.
  const notice = await waitForMessage(context.request, email, /pridaný nový kľúč/);
  expect(notice.Text).toContain('E2E kľúč');

  // Signed out (the cookie gone), the login page offers the passkey next to the email code.
  await context.clearCookies();
  await admin.goto('/login');
  await expect(admin.getByRole('button', { name: 'Poslať kód' })).toBeVisible();
  await admin.getByRole('button', { name: 'Prihlásiť sa kľúčom (passkey)' }).click();
  await expect(admin).not.toHaveURL(/\/login/);

  await admin.goto('/settings');
  await expect(admin.getByText(/^Naposledy použitý/)).toBeVisible();

  // Deleting it leaves the code login only.
  await admin.getByRole('button', { name: 'Vymazať' }).click();
  await admin.getByRole('button', { name: 'Vymazať kľúč' }).click();
  await expect(admin.getByText('Zatiaľ nemáte žiadny kľúč.')).toBeVisible();
  await context.close();
});
