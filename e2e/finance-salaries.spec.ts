import { expect, test, type BrowserContext } from '@playwright/test';
import { logInWithCode } from './login';

// Salaries ("Mzdy", owner request of 2026-10-21, ADR 0065): the superadmin (always a finance
// admin) records an admin's salary in the Položky card's Mzdy view of `/finance`, sees it in the
// list and the totals, and links a finance document to it; the overview counts it as money out.
// An admin without the finance right gets 404 from the salary routes, even for their own salary,
// and the not-found screen at `/finance`. One serial flow: production rate limits allow only a
// few code requests per minute.
test.describe.serial('salaries on /finance', () => {
  const stamp = Date.now();
  const adminName = `E2E Mzdová ${stamp}`;
  const email = `e2e-salary-${stamp}@example.com`;
  const documentTitle = `E2E Výplatná páska ${stamp}`;
  const year = new Date().getFullYear();
  let context: BrowserContext;
  let adminId = '';
  let salaryId = '';

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const added = await context.request.post('/api/admins', {
      data: { name: adminName, email },
    });
    expect(added.status()).toBe(201);
    adminId = ((await added.json()) as { id: string }).id;
    const document = await context.request.post('/api/finance/org/items', {
      data: { type: 'document', title: documentTitle },
    });
    expect(document.status()).toBe(201);
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('a finance admin records a salary and sees it with its totals', async () => {
    const page = await context.newPage();
    await page.goto(`/finance?period=custom&from=${year}-01&to=${year}-12`);
    const card = page.getByRole('region', { name: 'Položky' });
    await card.getByRole('radio', { name: 'Mzdy' }).click();
    await card.getByLabel('Administrátor', { exact: true }).selectOption({ label: adminName });
    await card.getByRole('button', { name: '+ Nová mzda' }).click();

    const sheet = page.getByTestId('salary-sheet');
    await expect(sheet.getByLabel('Administrátor', { exact: true })).toHaveValue(adminId);
    await sheet.getByLabel('Mesiac', { exact: true }).fill(`${year}-01`);
    await sheet.getByLabel('Suma', { exact: true }).fill('2 500,50');
    await sheet.getByLabel(/Poznámka/).fill('Januárová výplata');
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(
      sheet.getByRole('heading', { name: new RegExp(`^Mzda: ${adminName}`) }),
    ).toBeVisible();
    await expect(sheet.getByText(/2\s500,50\s€/)).toBeVisible();
    salaryId = new URL(page.url()).searchParams.get('salary') ?? '';
    expect(salaryId).not.toBe('');

    // Link the organisation's document.
    await sheet.getByRole('button', { name: 'Prepojiť dokument' }).click();
    await sheet.getByLabel('Hľadať dokument').fill(`páska ${stamp}`);
    const found = sheet.getByRole('listitem').filter({ hasText: documentTitle });
    await found.getByRole('button', { name: 'Prepojiť', exact: true }).click();
    await expect(
      sheet.getByTestId('linked-documents').getByText(documentTitle, { exact: true }),
    ).toBeVisible();
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();

    // The list of that admin, and its totals.
    const row = card.getByTestId('salary-row').filter({ hasText: adminName });
    await expect(row).toContainText(/2\s501\s€/);
    await expect(row).toContainText('1 dokument');
    await expect(card.getByTestId('salary-totals')).toContainText('1 mzda');
    // The overview counts the salary as money out.
    await expect(page.getByText(/z toho mzdy administrátorov/)).toBeVisible();
    await page.close();
  });

  test('an admin without the right gets 404, even for their own salary', async ({ browser }) => {
    const other = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
    const page = await other.newPage();
    await logInWithCode(page, other.request, email);
    for (const url of [
      '/api/finance/salaries',
      `/api/finance/salaries?admin=${adminId}`,
      `/api/finance/salaries/${salaryId}`,
    ]) {
      expect((await other.request.get(url)).status()).toBe(404);
    }
    await page.goto('/finance');
    await expect(page.getByText(documentTitle)).toHaveCount(0);
    await expect(page.getByText('Januárová výplata')).toHaveCount(0);
    await other.close();
  });
});
