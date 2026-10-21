import { expect, test, type Page } from '@playwright/test';
import { groupsFind } from './groups-find';
import { clearMailFor, latestLoginCode } from './mailpit';

async function createGroup(page: Page, name: string, egrantUrl: string, logo?: string) {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Vytvoriť klienta' }).first().click();
  await page.getByLabel('Názov').fill(name);
  await page.getByLabel('Adresa klienta v eGrante').fill(egrantUrl);
  if (logo) await page.getByLabel('Logo').setInputFiles(logo);
  await page.getByRole('button', { name: 'Uložiť' }).click();
  // The form closes once the group (and its logo) is saved.
  await expect(page.getByRole('button', { name: 'Vytvoriť klienta' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
}

// One serial flow: production rate limits allow only a few code requests per minute.
test('admin creates a group, a client joins by invite and is removed', async ({
  page,
  browser,
}) => {
  test.setTimeout(60_000); // a long scenario; the full parallel run nears 30 s
  const stamp = Date.now();
  const name = `E2E Group ${stamp}`;
  const email = `e2e-client-${stamp}@example.com`;

  await createGroup(page, name, `https://e2e-${stamp}.egrant.sk`, 'e2e/fixtures/logo.png');
  await page.goto('/groups');
  // The Groups page draws 50 rows at a time: find the group by name first.
  await groupsFind(page).fill(name);
  // The groups list's row, not the admin sidebar's link (it may list the new group too).
  const row = page.locator('a[href^="/groups/"]:not([href$="/chat"])', { hasText: name });
  await expect(row).toBeVisible();
  // The logo is lazy-loaded: bring the row on screen first (the list may be long).
  await row.scrollIntoViewIfNeeded();
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
  await page
    .getByRole('navigation', { name: 'Časti klienta' })
    .getByRole('link', { name: 'Úlohy' })
    .click();
  await expect(page).toHaveURL(/\/tasks$/);
  await expect(page.getByRole('heading', { name: 'Na spracovanie' })).toBeVisible();
  await page.getByRole('link', { name: 'Manažéri' }).click();
  await expect(page).toHaveURL(/\/members$/);

  // The clipboard is unreliable in headless: read the read-only field instead.
  const inviteUrl = await page.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
  expect(inviteUrl).toMatch(/\/join\//);

  // A second group, so the client can try to open a group that is not theirs.
  await createGroup(page, `${name} other`, `https://e2e-other-${stamp}.egrant.sk`);
  await page.goto('/groups');
  await groupsFind(page).fill(`${name} other`);
  await page
    .locator('a[href^="/groups/"]:not([href$="/chat"])', { hasText: `${name} other` })
    .click();
  await expect(page.getByRole('heading', { name: `${name} other` })).toBeVisible();
  const otherUrl = page.url().replace(/\/chat$/, '');

  // The client joins in a separate browser context.
  const clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await clientContext.newPage();
  await client.goto(new URL(inviteUrl).pathname);
  await expect(
    client.getByRole('heading', { name: `Pridajte sa ku klientovi ${name}` }),
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
  await expect(client.getByRole('link', { name: 'Klienti' })).toHaveCount(0);
  await expect(client.getByRole('textbox', { name: 'Napíšte správu…' })).toBeVisible();
  await client
    .getByRole('navigation', { name: 'Časti klienta' })
    .getByRole('link', { name: 'Úlohy' })
    .click();
  await expect(client).toHaveURL(/\/tasks$/);
  await expect(client.getByRole('heading', { name: 'Na spracovanie' })).toBeVisible();
  await client.getByRole('link', { name: 'Manažéri' }).click();
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
  await expect(page.getByText(`Odobraní manažéri (1)`)).toBeVisible();

  // The removed client loses access at once: the next navigation lands on /login.
  await client.goto(new URL(groupUrl).pathname);
  await expect(client).toHaveURL(/\/login/);
  await clientContext.close();
});

// Phase 22a: the Groups page's manager filter, order and count.
test('the Groups page filters by manager and shows the count', async ({ page }) => {
  // A random tail: the other test in this file may start in the same millisecond, and the
  // search below matches both of its groups by the stamp.
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const mine = `E2E Filter Mine ${stamp}`;
  const other = `E2E Filter Other ${stamp}`;
  const ids: string[] = [];
  for (const [name, host] of [
    [mine, `e2e-filter-mine-${stamp}`],
    [other, `e2e-filter-other-${stamp}`],
  ] as const) {
    const created = await page.request.post('/api/groups', {
      data: { name, egrantUrl: `https://${host}.egrant.sk` },
    });
    expect(created.status()).toBe(201);
    ids.push(((await created.json()) as { id: string }).id);
  }
  expect((await page.request.put(`/api/groups/${ids[0]}/managers/me`)).ok()).toBe(true);

  const groupRow = (name: string) =>
    page.locator('a[href^="/groups/"]:not([href$="/chat"])', { hasText: name });
  const count = page.locator('[data-group-count]');

  await page.goto('/groups');
  // The Groups page draws 50 rows at a time: find this test's two groups by their stamp.
  await groupsFind(page).fill(String(stamp));
  await expect(groupRow(mine)).toBeVisible();
  await expect(groupRow(other)).toBeVisible();
  await expect(count).toHaveText(/^2 z \d+$/);

  await page.getByRole('button', { name: 'Garant: Všetci' }).click();
  await page.getByRole('menuitemradio', { name: 'Ja' }).click();
  await expect(page).toHaveURL(/\?manager=me$/);
  await expect(groupRow(mine)).toBeVisible();
  await expect(groupRow(other)).toHaveCount(0);
  await expect(count).toHaveText(/^1 z \d+$/);

  // "Manažéri: N" opens the group's Members tab.
  await page
    .getByRole('listitem')
    .filter({ has: groupRow(mine) })
    .getByRole('link', { name: /^Manažéri: \d+$/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`/groups/${ids[0]}/members$`));
});
