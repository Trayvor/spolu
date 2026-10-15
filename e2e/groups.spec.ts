import { expect, test, type Page } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

async function createGroup(page: Page, name: string, egrantUrl: string, logo?: string) {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Vytvoriť skupinu' }).first().click();
  await page.getByLabel('Názov').fill(name);
  await page.getByLabel('Adresa klienta v eGrant').fill(egrantUrl);
  if (logo) await page.getByLabel('Logo').setInputFiles(logo);
  await page.getByRole('button', { name: 'Uložiť' }).click();
  // The form closes once the group (and its logo) is saved.
  await expect(page.getByRole('button', { name: 'Vytvoriť skupinu' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
}

// One serial flow: production rate limits allow only a few code requests per minute.
test('admin creates a group, a client joins by invite and is removed', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const name = `E2E Group ${stamp}`;
  const email = `e2e-client-${stamp}@example.com`;

  await createGroup(page, name, `https://e2e-${stamp}.egrant.sk`, 'e2e/fixtures/logo.png');
  await page.goto('/groups');
  const row = page.getByRole('link', { name: new RegExp(name) });
  await expect(row).toBeVisible();
  // The logo is decorative (alt=""), so find it by tag and check it really loaded.
  await expect(row.locator('img')).toBeVisible();
  await expect
    .poll(() => row.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await row.click();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  // /groups/:id redirects to the chat tab.
  await expect(page).toHaveURL(/\/groups\/[^/]+\/chat$/);
  const groupUrl = page.url().replace(/\/chat$/, '');
  await expect(page.getByRole('textbox', { name: 'Napíšte správu…' })).toBeVisible();
  await page.getByRole('link', { name: 'Úlohy' }).click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('heading', { name: 'Na spracovanie' })).toBeVisible();
  await page.getByRole('link', { name: 'Členovia' }).click();
  await expect(page).toHaveURL(/\/members$/);

  // The clipboard is unreliable in headless: read the read-only field instead.
  const inviteUrl = await page.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
  expect(inviteUrl).toMatch(/\/join\//);

  // A second group, so the client can try to open a group that is not theirs.
  await createGroup(page, `${name} other`, `https://e2e-other-${stamp}.egrant.sk`);
  await page.goto('/groups');
  await page.getByRole('link', { name: new RegExp(`${name} other`) }).click();
  await expect(page.getByRole('heading', { name: `${name} other` })).toBeVisible();
  const otherUrl = page.url().replace(/\/chat$/, '');

  // The client joins in a separate browser context.
  const clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await clientContext.newPage();
  await client.goto(new URL(inviteUrl).pathname);
  await expect(
    client.getByRole('heading', { name: `Pridajte sa ku skupine ${name}` }),
  ).toBeVisible();
  await clearMailFor(clientContext.request, email);
  await client.getByLabel('E-mail').fill(email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await expect(client.getByLabel('Kód')).toBeVisible();
  await client.getByLabel('Kód').fill(await latestLoginCode(clientContext.request, email));

  await expect(client.getByRole('heading', { name: 'Ako vás máme oslovovať?' })).toBeVisible();
  await client.getByLabel('Vaše meno').fill('E2E Client');
  await client.getByRole('button', { name: 'Pokračovať' }).click();

  await expect(client).toHaveURL(new RegExp(`${new URL(groupUrl).pathname}/chat$`));
  await expect(client.getByRole('heading', { name })).toBeVisible();
  await expect(client.getByRole('link', { name: 'Skupiny' })).toHaveCount(0);
  await expect(client.getByRole('textbox', { name: 'Napíšte správu…' })).toBeVisible();
  await client.getByRole('link', { name: 'Úlohy' }).click();
  await expect(client).toHaveURL(/\/tasks$/);
  await expect(client.getByRole('heading', { name: 'Na spracovanie' })).toBeVisible();
  await client.getByRole('link', { name: 'Členovia' }).click();
  await expect(client).toHaveURL(/\/members$/);
  await client.getByRole('link', { name: 'Chat' }).click();
  await expect(client).toHaveURL(/\/chat$/);

  // Another group's page is not found for the client.
  await client.goto(new URL(otherUrl).pathname);
  await expect(client.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();

  // The admin sees the client and removes them (Remove, then confirm).
  await page.goto(`${groupUrl}/members`);
  const member = page.getByRole('listitem').filter({ hasText: email });
  await expect(member).toBeVisible();
  await member.getByRole('button', { name: 'Odobrať' }).click();
  await page
    .getByRole('listitem')
    .filter({ hasText: 'E2E Client' })
    .getByRole('button', { name: 'Odobrať' })
    .click();
  await expect(page.getByText(`Odobraní členovia (1)`)).toBeVisible();

  // The removed client loses access at once: the next navigation lands on /login.
  await client.goto(new URL(groupUrl).pathname);
  await expect(client).toHaveURL(/\/login/);
  await clientContext.close();
});
