import { expect, test, type Page } from '@playwright/test';
import { groupsFind } from './groups-find';
import { clearMailFor, latestLoginCode } from './mailpit';

async function createGroup(page: Page, name: string, egrantUrl: string): Promise<string> {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Vytvoriť klienta' }).first().click();
  await page.getByLabel('Názov').fill(name);
  await page.getByLabel('Adresa klienta v eGrante').fill(egrantUrl);
  await page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(page.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
  // The groups list's row, not the admin sidebar's link (it may list the new group too).
  // The Groups page draws 50 rows at a time: find the group by name first.
  await groupsFind(page).fill(name);
  await page.locator('a[href^="/groups/"]:not([href$="/chat"])', { hasText: name }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+\/chat$/);
  return new URL(page.url()).pathname.replace(/\/chat$/, '');
}

async function inviteUrlOf(page: Page, groupPath: string): Promise<string> {
  await page.goto(`${groupPath}/members`);
  const url = await page.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
  return new URL(url).pathname;
}

// Phase 21, part 21.1: one person, a client of two groups.
test('a client joins a second group, switches between them and keeps one after removal', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const alfa = `E2E Alfa ${stamp}`;
  const beta = `E2E Beta ${stamp}`;
  const email = `e2e-two-groups-${stamp}@example.com`;
  const alfaPath = await createGroup(page, alfa, `https://e2e-alfa-${stamp}.egrant.sk`);
  const betaPath = await createGroup(page, beta, `https://e2e-beta-${stamp}.egrant.sk`);
  const alfaInvite = await inviteUrlOf(page, alfaPath);
  const betaInvite = await inviteUrlOf(page, betaPath);

  // Joins Alfa with the email code.
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await context.newPage();
  await client.goto(alfaInvite);
  await clearMailFor(context.request, email);
  await client.getByLabel('E-mail').fill(email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await client.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await client.getByLabel('Vaše meno').fill('E2E Two Groups');
  await client.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(client).toHaveURL(new RegExp(`${alfaPath}/chat$`));
  await expect(client.getByRole('link', { name: 'Moji klienti' })).toHaveCount(0);

  // Signed in, opens Beta's invite and joins with one button.
  await client.goto(betaInvite);
  await expect(client.getByText(`Prihlásili ste sa ako ${email}.`)).toBeVisible();
  await client.getByRole('button', { name: 'Pridať sa ku klientovi' }).click();
  await expect(client).toHaveURL(new RegExp(`${betaPath}/chat$`));
  await expect(client.getByRole('heading', { name: beta })).toBeVisible();

  // My groups lists both and switches between them.
  await client.getByRole('link', { name: 'Moji klienti' }).click();
  await expect(client).toHaveURL(/\/my-groups$/);
  await client.getByRole('link', { name: new RegExp(alfa) }).click();
  await expect(client.getByRole('heading', { name: alfa })).toBeVisible();
  await client.goto('/');
  await expect(client).toHaveURL(/\/my-groups$/);

  // The admin removes the client from Alfa only.
  await page.goto(`${alfaPath}/members`);
  const member = page.getByRole('listitem').filter({ hasText: 'E2E Two Groups' });
  await member.getByRole('button', { name: 'Odobrať' }).click();
  await member.getByRole('button', { name: 'Odobrať' }).click();
  await expect(page.getByText('Odobraní manažéri (1)')).toBeVisible();

  await client.goto(alfaPath);
  await expect(client.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();
  await client.goto('/');
  await expect(client).toHaveURL(new RegExp(`${betaPath}/chat$`));
  await context.close();
});
