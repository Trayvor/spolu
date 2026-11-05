import { expect, test, type APIRequestContext } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

// 2026-11-04, the ticket lifecycle rework: a client creates a ticket, which goes to the client's
// admin manager; opening it starts the work; the admin finishes and fills the time; the client
// declines, the admin finishes again with the time prefilled, and the client confirms.

/** Log in through the API with an emailed code (production rate limits allow few UI requests). */
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

test('both sides finish a ticket: decline, a second press, confirmation, rating', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  const stamp = `${Date.now()}-${test.info().repeatEachIndex}`;
  const adminEmail = `e2e-confirm-admin-${stamp}@example.com`;
  const authorEmail = `e2e-confirm-author-${stamp}@example.com`;
  const subject = `Potvrdenie ${stamp}`;

  // Setup through the API: a client, its admin manager, and the client's own user.
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Potvrdenie ${stamp}`, egrantUrl: `https://e2e-confirm-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const token = new URL(group.inviteUrl).pathname.split('/').pop();
  expect(
    (
      await page.request.post('/api/admins', {
        data: { name: `E2E Riešiteľ ${stamp}`, email: adminEmail },
      })
    ).ok(),
  ).toBe(true);
  const adminContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const authorContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  try {
    await signIn(adminContext.request, adminEmail);
    expect((await adminContext.request.put(`/api/groups/${group.id}/managers/me`)).ok()).toBe(true);
    expect(
      (
        await authorContext.request.post(`/api/join/${token}`, { data: { email: authorEmail } })
      ).ok(),
    ).toBe(true);
    await signIn(authorContext.request, authorEmail);
    // Without a name the app first asks for one ("Ako vás máme oslovovať?").
    expect(
      (
        await authorContext.request.patch('/api/me', { data: { name: `E2E Klient ${stamp}` } })
      ).ok(),
    ).toBe(true);

    // 1. The client creates the ticket; there is no programme to fill any more.
    const author = await authorContext.newPage();
    await author.goto(`/groups/${group.id}/tickets`);
    await author.getByRole('button', { name: 'Nový tiket', exact: true }).click();
    await expect(author.getByLabel('Grantový program')).toHaveCount(0);
    await author.getByLabel('Predmet').fill(subject);
    await author.getByRole('button', { name: 'Vytvoriť tiket', exact: true }).click();
    await expect(author).toHaveURL(/\/tickets\/[^/]+$/);
    await expect(author.getByRole('heading', { name: subject })).toBeVisible();
    const ticketUrl = new URL(author.url()).pathname;
    const id = ticketUrl.split('/').pop()!;
    await expect(author.getByRole('button', { name: 'Vyriešené', exact: true })).toBeVisible();

    // 2. The manager became its riešiteľ; opening the page starts the work, and the author sees it.
    const admin = await adminContext.newPage();
    await admin.goto(ticketUrl);
    await expect(admin.getByRole('heading', { name: 'Riešitelia (1)' })).toBeVisible();
    await expect(admin.getByRole('combobox', { name: 'Stav' })).toHaveValue('in_progress');
    await expect(author.getByText('V riešení').first()).toBeVisible({ timeout: 30_000 });

    // 3. The admin finishes and fills the time; the first press has nothing to keep.
    await admin.getByRole('button', { name: 'Vyriešené z našej strany' }).click();
    const dialog = admin.getByTestId('time-dialog');
    await dialog.getByLabel('Strávený čas').fill('1:30');
    await expect(dialog.getByRole('button', { name: 'Bez zmeny' })).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Uložiť' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(admin.getByText(/^Čaká na potvrdenie do /)).toBeVisible();

    // 4. The author sees the card live and says it is not solved yet: the admin's button returns.
    await expect(author.getByRole('heading', { name: /považuje požiadavku/ })).toBeVisible({
      timeout: 30_000,
    });
    await author.getByRole('button', { name: 'Ešte nie je vyriešené' }).click();
    await expect(author.getByRole('heading', { name: /považuje požiadavku/ })).toHaveCount(0);
    await expect(author.getByRole('button', { name: 'Vyriešené', exact: true })).toBeVisible();

    // 5. The admin presses again: the dialog holds the minutes and offers "No change".
    const again = admin.getByRole('button', { name: 'Vyriešené z našej strany' });
    await expect(again).toBeVisible({ timeout: 30_000 });
    await again.click();
    await expect(dialog.getByLabel('Strávený čas')).toHaveValue('1:30');
    await dialog.getByRole('button', { name: 'Bez zmeny' }).click();
    await expect(dialog).toHaveCount(0);

    // 6. The author confirms; the ticket is resolved and the rating opens.
    await author.getByRole('button', { name: 'Áno, vyriešené' }).click({ timeout: 30_000 });
    await expect(author.getByRole('heading', { name: 'Ako sme vám pomohli?' })).toBeVisible();
    await expect(author.getByRole('button', { name: 'Pomohlo', exact: true })).toBeVisible();
    await expect(admin.getByRole('combobox', { name: 'Stav' })).toHaveValue('resolved', {
      timeout: 30_000,
    });
    const ticket = (await (await adminContext.request.get(`/api/tickets/${id}`)).json()) as {
      status: string;
    };
    expect(ticket.status).toBe('resolved');
  } finally {
    await authorContext.close();
    await adminContext.close();
  }
});
