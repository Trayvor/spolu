import { expect, test, type BrowserContext } from '@playwright/test';
import { logInWithCode } from './login';

// Phase 32 E (spec 2026-10-18-finance-org-expenses-design.md): finance at organisation level.
// The superadmin (always a finance admin) records an admin's salary and another expense on
// `/finance`, makes a contract of two clients with a payer and shares that must add up, and each
// client's tab shows only its own share and the payer, read-only, with a link to `/finance`. An
// admin without the right reaches none of it. One serial flow: production rate limits allow only
// a few code requests per minute.
test.describe.serial('finance at organisation level (E)', () => {
  const stamp = Date.now();
  const payer = `Mikroregión ${stamp}`;
  const contractTitle = `E2E Spoločný grant ${stamp}`;
  const bill = `E2E Server ${stamp}`;
  const names = [`E2E Obec A ${stamp}`, `E2E Obec B ${stamp}`];
  const groupIds: string[] = [];
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    for (const [i, name] of names.entries()) {
      const created = await context.request.post('/api/groups', {
        data: { name, egrantUrl: `https://e2e-org-${i}-${stamp}.egrant.sk` },
      });
      expect(created.status()).toBe(201);
      groupIds.push(((await created.json()) as { id: string }).id);
    }
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('a salary in the future with its proposed reminder, and a bill paid today', async () => {
    const page = await context.newPage();
    await page.goto('/finance');
    const card = page.getByRole('region', { name: 'Položky' });
    await card.getByRole('button', { name: 'Nové' }).click();
    await page.getByRole('menuitem', { name: /Výdavok/ }).click();

    const sheet = page.getByTestId('finance-item-sheet');
    await expect(sheet.getByRole('radio', { name: 'Mzda administrátora' })).toBeChecked();
    await sheet.getByLabel('Administrátor', { exact: true }).selectOption({ index: 1 });
    await sheet.getByLabel('Suma', { exact: true }).fill('2 500');
    const year = new Date().getFullYear() + 1;
    await sheet.getByLabel('Dátum', { exact: true }).fill(`${year}-03-31`);
    // The proposal follows the date: the day before, at 09:00.
    await expect(sheet.locator('input[type="date"]').nth(1)).toHaveValue(`${year}-03-30`);
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(sheet.getByRole('heading', { name: /^Mzda: / })).toBeVisible();
    await expect(sheet.getByText(/2\s500,00\s€/)).toBeVisible();
    await expect(sheet.getByText('plánovaný')).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Pripomienky' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();

    await card.getByRole('button', { name: 'Nové' }).click();
    await page.getByRole('menuitem', { name: /Výdavok/ }).click();
    await sheet.getByRole('radio', { name: 'Iný výdavok' }).check();
    await sheet.getByLabel('Za čo', { exact: true }).fill(bill);
    await sheet.getByLabel('Suma', { exact: true }).fill('49');
    const today = new Date().toISOString().slice(0, 10);
    await sheet.getByLabel('Dátum', { exact: true }).fill(today);
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(sheet.getByRole('heading', { name: bill })).toBeVisible();
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();

    // The ledger lists it under Výdavky; the overview counts it as money out.
    await card.getByRole('button', { name: 'Výdavky', exact: true }).click();
    await expect(card.getByTestId('contract-row').filter({ hasText: bill })).toContainText(
      'Organizácia',
    );
    await expect(page.getByText('Výdavky (EUR)')).toBeVisible();
    await expect(page.getByText('Bilancia po výdavkoch')).toBeVisible();
    await page.close();
  });

  test('a contract of two clients with a payer and shares that add up', async () => {
    const page = await context.newPage();
    await page.goto('/finance');
    const card = page.getByRole('region', { name: 'Položky' });
    await card.getByRole('button', { name: 'Nové' }).click();
    await page.getByRole('menuitem', { name: /Zmluva/ }).click();
    const sheet = page.getByTestId('finance-item-sheet');
    await sheet.getByRole('radio', { name: 'Viacero klientov' }).check();
    await sheet.getByLabel('Názov', { exact: true }).fill(contractTitle);
    await sheet.getByLabel('Suma', { exact: true }).fill('3 000');
    const year = new Date().getFullYear();
    await sheet.getByLabel('Od', { exact: true }).fill(`${year}-01-01`);
    await sheet.getByLabel('Do', { exact: true }).fill(`${year + 1}-12-31`);
    await sheet.getByLabel('Nadradená organizácia', { exact: true }).fill(payer);
    const clients = sheet.getByTestId('share-client');
    const amounts = sheet.getByTestId('share-amount');
    await clients.nth(0).selectOption({ label: names[0]! });
    await clients.nth(1).selectOption({ label: names[1]! });
    await amounts.nth(0).fill('1 000');
    await amounts.nth(1).fill('1 500');
    await expect(sheet.getByTestId('shares-status')).toContainText(/Zostáva rozdeliť 500,00\s€/);
    // Shares that do not add up are refused before anything is sent.
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(sheet.getByText('Podiely musia dať spolu presne sumu zmluvy.')).toBeVisible();
    await amounts.nth(1).fill('2 000');
    await expect(sheet.getByTestId('shares-status')).toContainText('presne');
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(sheet.getByRole('heading', { name: contractTitle })).toBeVisible();
    await expect(sheet.getByText(payer)).toBeVisible();
    await expect(sheet.getByRole('link', { name: names[0]! })).toBeVisible();
    await expect(sheet.getByRole('link', { name: names[1]! })).toBeVisible();
    await page.close();
  });

  test("each client's tab shows only its own share and the payer, read-only", async () => {
    const page = await context.newPage();
    await page.goto(`/groups/${groupIds[0]}/finance`);
    const card = page.getByRole('region', { name: 'Dokumenty' });
    const row = card.getByTestId('finance-item-row').filter({ hasText: contractTitle });
    await expect(row).toContainText(`Nadradená organizácia: ${payer}`);
    await expect(row).toContainText(/1\s000,00\s€/);
    await row.click();
    const sheet = page.getByTestId('finance-item-sheet');
    await expect(sheet.getByTestId('share-amount')).toHaveText(/1\s000,00\s€/);
    await expect(sheet.getByText(/3\s000,00\s€/)).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Upraviť' })).toHaveCount(0);
    await expect(sheet.getByText(names[1]!)).toHaveCount(0);
    await sheet.getByTestId('edit-on-finance').click();
    await expect(page).toHaveURL(/\/finance\?item=/);
    await expect(page.getByTestId('finance-item-sheet').getByText(names[1]!)).toBeVisible();
    await page.close();
  });

  test('an admin without the right reaches none of it', async ({ browser }) => {
    const email = `e2e-fin-e-${stamp}@example.com`;
    const added = await context.request.post('/api/admins', {
      data: { name: `E2E Admin E ${stamp}`, email },
    });
    expect(added.status()).toBe(201);
    const other = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
    const page = await other.newPage();
    await logInWithCode(page, other.request, email);
    for (const url of [
      '/api/finance/org/items',
      '/api/finance/contracts?type=expense',
      '/api/finance/payees',
      `/api/groups/${groupIds[0]}/finance/items`,
    ]) {
      expect((await other.request.get(url)).status()).toBe(403);
    }
    await page.goto('/finance');
    await expect(page.getByText(bill)).toHaveCount(0);
    await other.close();
  });
});
