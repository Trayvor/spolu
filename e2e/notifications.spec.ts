import { expect, test } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

// One client logs in once (production rate limits allow only a few code requests per minute).
test('the client switches the bell to Mentions and replies and it sticks after reload', async ({
  page: admin,
  browser,
}) => {
  const stamp = Date.now();
  const email = `e2e-bell-${stamp}@example.com`;

  await admin.goto('/groups');
  await admin.getByRole('button', { name: 'Vytvoriť skupinu' }).first().click();
  await admin.getByLabel('Názov').fill(`E2E Bell ${stamp}`);
  await admin.getByLabel('Adresa klienta v eGrant').fill(`https://e2e-bell-${stamp}.egrant.sk`);
  await admin.getByRole('button', { name: 'Uložiť' }).click();
  await expect(admin.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
  await admin.getByRole('link', { name: new RegExp(`E2E Bell ${stamp}`) }).click();
  const groupPath = new URL(admin.url()).pathname.replace(/\/chat$/, '');
  await admin.goto(`${groupPath}/members`);
  const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();

  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await context.newPage();
  await client.goto(new URL(inviteUrl).pathname);
  await clearMailFor(context.request, email);
  await client.getByLabel('E-mail').fill(email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await client.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await client.getByLabel('Vaše meno').fill('E2E Bell Client');
  await client.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(client).toHaveURL(new RegExp(`${groupPath}/chat$`));

  // A client starts on "All messages".
  await client.getByRole('button', { name: 'Upozornenia: Všetky správy' }).click();
  await client.getByRole('menuitemradio', { name: /Zmienky a odpovede/ }).click();
  await expect(
    client.getByRole('button', { name: 'Upozornenia: Zmienky a odpovede' }),
  ).toBeVisible();

  await client.reload();
  await expect(
    client.getByRole('button', { name: 'Upozornenia: Zmienky a odpovede' }),
  ).toBeVisible();
  await context.close();
});
