import { expect, test } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

// One serial flow in two browsers: production rate limits allow only a few code requests per minute,
// so the client logs in once, through the API. The admin uses the shared stored superadmin session.
test('admin and client work on the same task board live', async ({ page: admin, browser }) => {
  const stamp = Date.now();
  const email = `e2e-tasks-${stamp}@example.com`;
  const card = (title: string) => (p: typeof admin) => p.getByRole('link', { name: title });
  const bucket = (p: typeof admin, name: string) => p.getByRole('region', { name });

  // Setup through the API: a group, its invite link, a client who joined and logged in.
  const created = await admin.request.post('/api/groups', {
    data: { name: `E2E Tasks ${stamp}`, egrantUrl: `https://e2e-tasks-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const token = new URL(group.inviteUrl).pathname.split('/').pop();

  const clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const request = clientContext.request;
  try {
    await clearMailFor(request, email);
    expect((await request.post(`/api/join/${token}`, { data: { email } })).ok()).toBe(true);
    expect(
      (
        await request.post('/api/auth/email-otp/send-verification-otp', {
          data: { email, type: 'sign-in' },
        })
      ).ok(),
    ).toBe(true);
    const otp = await latestLoginCode(request, email);
    expect((await request.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(
      true,
    );
    expect((await request.patch('/api/me', { data: { name: 'E2E Klient' } })).ok()).toBe(true);

    const client = await clientContext.newPage();
    const url = `/groups/${group.id}/tasks`;
    await Promise.all([admin.goto(url), client.goto(url)]);
    await expect(bucket(admin, 'Na spracovanie')).toBeVisible();
    await expect(bucket(client, 'Na spracovanie')).toBeVisible();

    // The client adds a card; the admin sees it without reloading.
    await client.getByRole('button', { name: 'Pridať úlohu' }).first().click();
    await client.getByLabel('Názov úlohy').fill('Rozpočet');
    await client.getByLabel('Názov úlohy').press('Enter');
    await expect(bucket(client, 'Na spracovanie').getByText('Rozpočet')).toBeVisible();
    await expect(bucket(admin, 'Na spracovanie').getByText('Rozpočet')).toBeVisible();

    // The admin moves it with the keyboard: Space lifts, ArrowRight crosses a column, Space drops.
    await card('Rozpočet')(admin).focus();
    await admin.keyboard.press('Space');
    // dnd-kit starts listening for the arrow keys a tick after the lift is announced.
    await expect(admin.getByText('Úloha Rozpočet je nad stĺpcom Na spracovanie.')).toBeAttached();
    await admin.waitForTimeout(300);
    await admin.keyboard.press('ArrowRight');
    await expect(admin.getByText('Úloha Rozpočet je nad stĺpcom Kontrola eGrant.')).toBeAttached();
    await admin.keyboard.press('Space');
    await expect(bucket(admin, 'Kontrola eGrant').getByText('Rozpočet')).toBeVisible();
    await expect(bucket(client, 'Kontrola eGrant').getByText('Rozpočet')).toBeVisible();

    // The client opens the card, marks it urgent, attaches a file and saves.
    await card('Rozpočet')(client).click();
    const panel = client.getByRole('complementary', { name: 'Úloha' });
    await expect(panel).toBeVisible();
    await panel.getByRole('switch', { name: 'Urgentné' }).click();
    await panel.getByTestId('task-file-input').setInputFiles('e2e/fixtures/logo.png');
    await expect(panel.getByRole('link', { name: /logo\.png/ })).toBeVisible();
    await panel.getByRole('button', { name: 'Uložiť zmeny' }).click();
    await expect(panel.getByRole('button', { name: 'Uložiť zmeny' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Zavrieť' }).click();

    // The admin sees the Urgent pill and the paperclip on the card.
    const adminCard = card('Rozpočet')(admin);
    await expect(adminCard.getByText('Urgentné')).toBeVisible();
    await expect(adminCard.getByText('1 súbor')).toBeAttached();

    // The admin opens the task; the attached file answers 200.
    await adminCard.click();
    const adminPanel = admin.getByRole('complementary', { name: 'Úloha' });
    const href = await adminPanel
      .locator('a[href^="/api/files/"]:not([href$="/preview"])')
      .first()
      .getAttribute('href');
    expect(href).toBeTruthy();
    expect((await admin.request.get(href!)).status()).toBe(200);
    await adminPanel.getByRole('button', { name: 'Zavrieť' }).click();
    await expect(adminPanel).toHaveCount(0);

    // The admin adds a custom column; the client sees it, then the admin deletes it (confirm).
    await admin.getByRole('button', { name: 'Pridať stĺpec' }).click();
    await admin.getByLabel('Názov stĺpca').fill('Moje');
    await admin.getByLabel('Názov stĺpca').press('Enter');
    await expect(bucket(admin, 'Moje')).toBeVisible();
    await expect(bucket(client, 'Moje')).toBeVisible();
    await bucket(admin, 'Moje').getByRole('button', { name: 'Viac' }).click();
    await admin.getByRole('menuitem', { name: 'Odstrániť' }).click();
    await bucket(admin, 'Moje').getByRole('button', { name: 'Odstrániť' }).click();
    await expect(bucket(admin, 'Moje')).toHaveCount(0);
    await expect(bucket(client, 'Moje')).toHaveCount(0);
  } finally {
    await clientContext.close();
  }
});
