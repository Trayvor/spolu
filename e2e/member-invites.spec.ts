import { expect, test, type Browser, type Page } from '@playwright/test';
import { groupsFind } from './groups-find';
import { clearMailFor, latestLoginCode, subjectsFor } from './mailpit';

// Phase 22b: an admin adds people to a group by email on its Members tab.

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
  await page.locator('a[href^="/groups/"]:not([href$="/overview"])', { hasText: name }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+\/overview$/);
  return new URL(page.url()).pathname.replace(/\/overview$/, '');
}

/** On the group's Members tab, adds `email` (and `name`) with the form. */
async function addByEmail(page: Page, groupPath: string, email: string, name = '') {
  await page.goto(`${groupPath}/members`);
  await page.getByRole('button', { name: '+ Pridať manažéra' }).click();
  const form = page.getByRole('form', { name: 'Pridať manažéra e-mailom' });
  await form.getByLabel('E-mail', { exact: true }).fill(email);
  if (name) await form.getByLabel('Meno (nepovinné)').fill(name);
  await form.getByRole('button', { name: 'Pridať', exact: true }).click();
  await expect(form).toHaveCount(0);
}

/** Signs `email` in, in a new browser context, through the invitation's login link. */
async function signInFromLink(browser: Browser, email: string) {
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const client = await context.newPage();
  await client.goto(`/login?email=${encodeURIComponent(email)}`);
  await expect(client.getByLabel('E-mail')).toHaveValue(email);
  await clearMailFor(context.request, email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await client.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await expect(client).not.toHaveURL(/\/login/);
  return { context, client };
}

const rowOf = (page: Page, text: string) => page.getByRole('listitem').filter({ hasText: text });

test('a new person is invited, signs in and becomes a member', async ({ page, browser }) => {
  const stamp = Date.now();
  const group = `E2E Pozvánka ${stamp}`;
  const email = `new-${stamp}@example.com`;
  const path = await createGroup(page, group, `https://e2e-invite-${stamp}.egrant.sk`);

  await addByEmail(page, path, email, 'E2E Nová Osoba');
  await expect(page.getByText(`Pozvánka odoslaná na ${email}.`)).toBeVisible();
  const row = rowOf(page, email);
  await expect(row.getByText('Pozvaný', { exact: true })).toBeVisible();
  await expect
    .poll(() => subjectsFor(page.request, email))
    .toContain(`Pozvánka do aplikácie Help – ${group}`);

  const { context, client } = await signInFromLink(browser, email);
  await expect(client).toHaveURL(new RegExp(`${path}/chat$`));
  await context.close();

  await page.reload();
  const member = rowOf(page, 'E2E Nová Osoba');
  await expect(member).toBeVisible();
  await expect(member.getByText('Pozvaný', { exact: true })).toHaveCount(0);
});

test('a client of another group is added at once', async ({ page, browser }) => {
  const stamp = Date.now();
  const alfa = `E2E Pridanie A ${stamp}`;
  const beta = `E2E Pridanie B ${stamp}`;
  const email = `e2e-added-${stamp}@example.com`;
  const alfaPath = await createGroup(page, alfa, `https://e2e-add-a-${stamp}.egrant.sk`);
  const betaPath = await createGroup(page, beta, `https://e2e-add-b-${stamp}.egrant.sk`);

  // A signed-in client of Alfa.
  await addByEmail(page, alfaPath, email, 'E2E Klient Alfa');
  const { context, client } = await signInFromLink(browser, email);

  await addByEmail(page, betaPath, email);
  await expect(
    page.getByText(`${email} je teraz manažérom klienta. Poslali sme mu e-mail.`),
  ).toBeVisible();
  const member = rowOf(page, 'E2E Klient Alfa');
  await expect(member).toBeVisible();
  await expect(member.getByText('Pozvaný', { exact: true })).toHaveCount(0);

  await client.goto('/my-groups');
  await expect(client.getByRole('link', { name: new RegExp(alfa) })).toBeVisible();
  await expect(client.getByRole('link', { name: new RegExp(beta) })).toBeVisible();
  await context.close();
});

test('cancel removes an invited row', async ({ page }) => {
  const stamp = Date.now();
  const email = `e2e-cancel-${stamp}@example.com`;
  const path = await createGroup(
    page,
    `E2E Zrušenie ${stamp}`,
    `https://e2e-cancel-${stamp}.egrant.sk`,
  );

  await addByEmail(page, path, email);
  const row = rowOf(page, email);
  await expect(row.getByText('Pozvaný', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Odobrať' }).click();
  await expect(row.getByText(`Zrušiť pozvánku pre ${email}?`)).toBeVisible();
  await row.getByRole('button', { name: 'Odobrať' }).click();
  await expect(rowOf(page, email)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Manažéri' })).toBeVisible();
  await expect(rowOf(page, email)).toHaveCount(0);
  await expect(page.getByText(/Odobraní manažéri/)).toHaveCount(0);
});
