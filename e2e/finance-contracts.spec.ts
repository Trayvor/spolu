import { expect, test, type BrowserContext } from '@playwright/test';

// Contracts v2 (owner request of 2026-10-21, ADR 0066). The superadmin (always a finance admin)
// makes a contract under a master contract with a monthly payment schedule in a client's
// Financie tab, links a document recording a payment, and sees the master's contracts, the
// expected payments with the paid one, and "Očakávané platby" in the Summary card. The master is
// made through the API (the UI flow is the child's). One serial flow.
test.describe.serial('finance contracts v2', () => {
  const stamp = Date.now();
  const masterTitle = `E2E Rámcová ${stamp}`;
  const childTitle = `E2E Dodatok ${stamp}`;
  const docTitle = `E2E Faktúra ${stamp}`;
  const year = new Date().getFullYear();
  let groupId = '';
  let context: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const created = await context.request.post('/api/groups', {
      data: {
        name: `E2E Obec zmluvy ${stamp}`,
        egrantUrl: `https://e2e-contracts-${stamp}.egrant.sk`,
      },
    });
    expect(created.status()).toBe(201);
    groupId = ((await created.json()) as { id: string }).id;
    const master = await context.request.post(`/api/groups/${groupId}/finance/items`, {
      data: {
        type: 'contract',
        title: masterTitle,
        amount: { amountMinor: 0, currency: 'EUR' },
        startsOn: `${year}-01-01`,
        endsOn: `${year}-12-31`,
      },
    });
    expect(master.status()).toBe(201);
  });
  test.afterAll(async () => {
    await context.close();
  });

  test('a contract under a master with a monthly schedule, paid by a linked document', async () => {
    const page = await context.newPage();
    await page.goto(`/groups/${groupId}/finance`);
    const card = page.getByRole('region', { name: 'Dokumenty' });
    await card.getByRole('button', { name: 'Nové' }).click();
    await page.getByRole('menuitem', { name: /Zmluva/ }).click();
    const sheet = page.getByTestId('finance-item-sheet');
    await sheet.getByLabel('Názov', { exact: true }).fill(childTitle);
    await sheet.getByLabel('Suma', { exact: true }).fill('7 200');
    await sheet.getByLabel('Od', { exact: true }).fill(`${year}-01-01`);
    await sheet.getByLabel('Do', { exact: true }).fill(`${year}-12-31`);
    await sheet.getByLabel(/Rámcová zmluva/).selectOption({ label: masterTitle });
    const schedule = sheet.getByTestId('schedule-field');
    await schedule.getByLabel('Ako často sa očakáva platba').selectOption('monthly');
    await schedule.getByLabel('Suma jednej platby').fill('600');
    await schedule.getByLabel('Prvá platba').fill(`${year}-01-01`);
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(sheet.getByRole('heading', { name: childTitle })).toBeVisible();
    await expect(sheet.getByTestId('contract-master')).toContainText(masterTitle);
    await expect(sheet.getByTestId('contract-schedule')).toContainText('každý mesiac');
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();

    // A document of the client, linked with the January payment.
    await card.getByRole('button', { name: 'Nové' }).click();
    await page.getByRole('menuitem', { name: /Dokument/ }).click();
    await sheet.getByLabel('Názov', { exact: true }).fill(docTitle);
    const link = sheet.getByTestId('contract-link-field');
    await link.getByRole('combobox').selectOption({ label: childTitle });
    await link.getByLabel(/Prijatá platba/).fill('600');
    await link.getByLabel('Dátum platby').fill(`${year}-01-05`);
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(sheet.getByTestId('document-contract')).toContainText(childTitle);
    // The contract opens from the document and shows January paid.
    await sheet.getByTestId('document-contract').getByRole('button', { name: childTitle }).click();
    const payments = sheet.getByTestId('contract-schedule');
    await expect(payments.getByRole('img', { name: 'Uhradené' }).first()).toBeVisible();
    await expect(sheet.getByTestId('contract-documents')).toContainText(docTitle);
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();

    // The master lists the contract under it.
    await card.getByText(masterTitle).click();
    await expect(sheet.getByTestId('contract-children')).toContainText(childTitle);
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();

    // The Summary card shows the expected payments, labelled as expected.
    const overview = page.getByRole('region', { name: 'Súhrn' });
    const expected = overview.getByTestId('finance-expected');
    await expect(expected.getByRole('heading', { name: 'Očakávané platby' })).toBeVisible();
    await expect(expected).toContainText(childTitle);
    await expect(expected).toContainText('každý mesiac');
    await page.close();
  });
});
