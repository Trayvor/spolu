import { expect, test, type APIRequestContext } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

/** Log in through the API with an emailed code: production rate limits allow few UI code requests. */
async function signIn(request: APIRequestContext, email: string) {
  await clearMailFor(request, email);
  const sent = await request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email, type: 'sign-in' },
  });
  expect(sent.ok()).toBe(true);
  const otp = await latestLoginCode(request, email);
  expect((await request.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(
    true,
  );
}

// Admin substitution (2026-10-19, ADR 0059): the superadmin sets "Y substitutes X" on the
// Administrators page, the client sees Y among the managers as X's substitute, and ending it
// takes Y off again.
test('substitute an admin from the Administrators page and end it', async ({ page, browser }) => {
  const stamp = `${Date.now()}-${test.info().repeatEachIndex}`;
  const xName = `E2E Preč ${stamp}`;
  const yName = `E2E Zástup ${stamp}`;
  const clientEmail = `e2e-subst-client-${stamp}@example.com`;

  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Zastupovanie ${stamp}`, egrantUrl: `https://e2e-subst-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const token = new URL(group.inviteUrl).pathname.split('/').pop();
  const x = await page.request.post('/api/admins', {
    data: { name: xName, email: `e2e-subst-x-${stamp}@example.com` },
  });
  const y = await page.request.post('/api/admins', {
    data: { name: yName, email: `e2e-subst-y-${stamp}@example.com` },
  });
  const xId = ((await x.json()) as { id: string }).id;
  expect(y.ok()).toBe(true);
  expect((await page.request.put(`/api/groups/${group.id}/managers/${xId}`)).ok()).toBe(true);

  const client = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  try {
    expect(
      (await client.request.post(`/api/join/${token}`, { data: { email: clientEmail } })).ok(),
    ).toBe(true);
    await signIn(client.request, clientEmail);
    expect(
      (await client.request.patch('/api/me', { data: { name: `E2E Klient ${stamp}` } })).ok(),
    ).toBe(true);

    // 1. Set the substitution in the dialog.
    await page.goto('/admins');
    await page.getByRole('button', { name: `Zastúpiť: ${xName}` }).click();
    const dialog = page.getByTestId('substitution-dialog');
    await expect(dialog.getByRole('heading', { name: `Zastúpiť: ${xName}` })).toBeVisible();
    await dialog.getByLabel('Kto zastupuje').selectOption({ label: yName });
    await dialog.getByRole('button', { name: 'Zastúpiť', exact: true }).click();
    await expect(dialog).toBeHidden();
    const xRow = page.getByRole('listitem').filter({ hasText: xName });
    await expect(xRow.getByText(`Zastupuje: ${yName}`)).toBeVisible();

    // 2. The client sees Y among the managers, marked as X's substitute.
    const c = await client.newPage();
    await c.goto(`/groups/${group.id}/members`);
    const managers = c.getByRole('list', { name: 'Garanti z eGrantu' });
    await expect(managers.getByText(yName)).toBeVisible();
    await expect(managers.getByText(`zastupuje ${xName}`)).toBeVisible();

    // 3. End it with one click: Y is no longer a manager, X still is.
    await xRow.getByRole('button', { name: `Ukončiť zastupovanie: ${xName}` }).click();
    await expect(xRow.getByText(`Zastupuje: ${yName}`)).toBeHidden();
    await c.reload();
    await expect(managers.getByText(xName)).toBeVisible();
    await expect(managers.getByText(yName)).toBeHidden();
  } finally {
    await client.close();
  }
});
