import { expect, test, type BrowserContext } from '@playwright/test';
import type { FinanceItemPage } from '@spolu/shared';
import { logInWithCode } from './login';

// Phase 32 end-to-end scenarios (spec §14). Each part adds its own `describe` block: part B
// writes scenario 2 here; parts A2, C and D add theirs (D runs the whole file).

// Scenario 2, "Contract" (part B): the superadmin (always a finance admin, decision 1) keeps a
// client's contract with a PDF and the proposed reminder; the knowledge base never finds it and
// an admin without the right cannot download its file. One serial flow: production rate limits
// allow only a few code requests per minute. The money totals are part C's (scenario 4).
test.describe.serial('finance: documents and contracts (B)', () => {
  const stamp = Date.now();
  const title = `E2E Zmluva ${stamp}`;
  let groupId = '';
  let financeContext: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    financeContext = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const created = await financeContext.request.post('/api/groups', {
      data: { name: `E2E Financie ${stamp}`, egrantUrl: `https://e2e-fin-${stamp}.egrant.sk` },
    });
    expect(created.status()).toBe(201);
    groupId = ((await created.json()) as { id: string }).id;
  });
  test.afterAll(async () => {
    await financeContext.close();
  });

  test('a contract with a PDF and the proposed reminder', async () => {
    const page = await financeContext.newPage();
    await page.goto(`/groups/${groupId}/finance`);
    const card = page.getByRole('region', { name: 'Dokumenty' });
    await card.getByRole('button', { name: 'Nové' }).click();
    await page.getByRole('menuitem', { name: /Zmluva/ }).click();

    const sheet = page.getByTestId('finance-item-sheet');
    await sheet.getByLabel('Názov', { exact: true }).fill(title);
    await sheet.getByLabel('Číslo zmluvy').fill(`Z-${stamp}`);
    await sheet.getByLabel('Suma', { exact: true }).fill('12 000');
    const year = new Date().getFullYear() + 1;
    await sheet.getByLabel('Od', { exact: true }).fill(`${year}-01-01`);
    await sheet.getByLabel('Do', { exact: true }).fill(`${year}-12-31`);
    // The proposal follows the end date: 30 days before it, at 09:00.
    await expect(sheet.locator('input[type="date"]').nth(2)).toHaveValue(`${year}-12-01`);
    await sheet.getByTestId('finance-file-input').setInputFiles({
      name: `zmluva-${stamp}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n12 000 EUR\n'),
    });
    await expect(sheet.getByText(`zmluva-${stamp}.pdf`)).toBeVisible();
    await sheet.getByRole('button', { name: 'Vytvoriť' }).click();

    // The saved contract opens, with its amount, period and reminder.
    await expect(sheet.getByRole('heading', { name: title })).toBeVisible();
    await expect(sheet.getByText(/12\s000,00\s€/)).toBeVisible();
    await expect(sheet.getByText(`1. 1. ${year} – 31. 12. ${year}`)).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Pripomienky' })).toBeVisible();
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();

    // The card lists it.
    const row = card.getByTestId('finance-item-row').filter({ hasText: title });
    await expect(row).toContainText(`Z-${stamp}`);
    await expect(row).toContainText(/12\s000,00\s€/);
    await expect(row.getByText('Má nadchádzajúcu pripomienku')).toBeAttached();
    await page.close();
  });

  test('the knowledge base never finds it', async () => {
    const request = financeContext.request;
    for (const url of [
      `/api/groups/${groupId}/knowledge?q=${encodeURIComponent(title)}`,
      `/api/knowledge?scope=all&q=${encodeURIComponent(title)}`,
    ]) {
      const res = await request.get(url);
      expect(res.status()).toBe(200);
      expect(await res.text()).not.toContain(title);
    }
    const page = await financeContext.newPage();
    await page.goto(`/groups/${groupId}/knowledge`);
    await page.getByRole('searchbox', { name: /Hľadať/ }).fill(title);
    await expect(page.getByText(title)).toHaveCount(0);
    await page.close();
  });

  test('an admin without the right cannot reach it or download its file', async ({ browser }) => {
    const items = (await (
      await financeContext.request.get(
        `/api/groups/${groupId}/finance/items?q=${encodeURIComponent(title)}`,
      )
    ).json()) as FinanceItemPage;
    const itemId = items.items[0]!.id;
    const detail = (await (
      await financeContext.request.get(`/api/finance/items/${itemId}`)
    ).json()) as { files: { id: string }[] };
    const fileId = detail.files[0]!.id;
    expect((await financeContext.request.get(`/api/files/${fileId}`)).status()).toBe(200);

    const email = `e2e-fin-b-${stamp}@example.com`;
    const added = await financeContext.request.post('/api/admins', {
      data: { name: `E2E Admin B ${stamp}`, email },
    });
    expect(added.status()).toBe(201);
    const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
    const page = await context.newPage();
    await logInWithCode(page, context.request, email);
    expect((await context.request.get(`/api/files/${fileId}`)).status()).toBe(404);
    expect((await context.request.get(`/api/finance/items/${itemId}`)).status()).toBe(403);
    expect((await context.request.get(`/api/groups/${groupId}/finance/items`)).status()).toBe(403);
    await context.close();
  });
});
