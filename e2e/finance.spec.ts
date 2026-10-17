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
    // Wait for the finished upload (the attached file's link), not for the name: the
    // "Nahráva sa <name>" status shows it too, and Create before the upload ends saves no file.
    await expect(
      sheet.getByRole('link', { name: new RegExp(`zmluva-${stamp}\\.pdf`) }),
    ).toBeVisible();
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

/**
 * Phase 32, Finančná správa. Each part keeps to its own `describe` block (plan, "Conflict rules").
 */

const bratislavaDay = (offsetDays = 0) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );

// Part C: spec §14 scenario 4 (work log and cost). The time on done of part A2 feeds the same
// log; here the time comes from manual entries, so the scenario does not depend on A2.
test.describe('finance work log and cost (part C)', () => {
  test('rates turn hours into cost, a manual entry adds to the log, hours show per admin', async ({
    page,
  }) => {
    const stamp = Date.now();
    // The superadmin always has finance access (owner decision 1).
    const me = (await (await page.request.get('/api/me')).json()) as { id: string; name: string };
    const created = await page.request.post('/api/groups', {
      data: { name: `E2E Financie ${stamp}`, egrantUrl: `https://e2e-fin-c-${stamp}.egrant.sk` },
    });
    expect(created.status()).toBe(201);
    const group = (await created.json()) as { id: string };
    const bName = `E2E Admin B ${stamp}`;
    const added = await page.request.post('/api/admins', {
      data: { name: bName, email: `e2e-fin-c-${stamp}@example.com` },
    });
    expect(added.ok()).toBe(true);
    const b = (await added.json()) as { id: string };
    // The superadmin's own rate through the API: 40 €/h from the start.
    expect(
      (
        await page.request.post('/api/finance/rates', {
          data: { userId: me.id, rateMinor: 4000, effectiveFrom: null },
        })
      ).status(),
    ).toBe(201);

    await page.goto(`/groups/${group.id}/finance`);
    const log = page.getByRole('region', { name: 'Výkaz práce' });
    await expect(log.getByText('V tomto období zatiaľ nie je zapísaný čas.')).toBeVisible();

    // B's rate in the rates dialog: 50 €/h, B's first rate, so from the start.
    await log.getByRole('button', { name: 'Hodinové sadzby' }).click();
    const rates = page.getByTestId('finance-rates');
    const bRow = rates.getByTestId('rate-row').filter({ hasText: bName });
    await bRow.getByRole('button', { name: 'Zmeniť' }).click();
    await expect(bRow.getByRole('checkbox', { name: 'Od začiatku' })).toBeChecked();
    await bRow.getByLabel('Sadzba za hodinu (EUR)').fill('50');
    await bRow.getByRole('button', { name: 'Uložiť' }).click();
    await expect(bRow).toContainText('50,00 € / h');
    await rates.getByRole('button', { name: 'Zavrieť' }).click();

    // The superadmin's 1 h 30 min today (60 €), then B's 2 h yesterday (100 €).
    const add = async (name: string, day: string, duration: string) => {
      await log.getByRole('button', { name: 'Pridať čas' }).click();
      const dialog = page.getByTestId('finance-entry');
      await dialog.getByLabel('Admin').selectOption({ label: name });
      await dialog.getByLabel('Deň').fill(day);
      await dialog.getByLabel('Strávený čas').fill(duration);
      await dialog.getByRole('button', { name: 'Uložiť' }).click();
      await expect(dialog).toBeHidden();
    };
    await add(me.name, bratislavaDay(), '1:30');
    const entries = log.getByTestId('work-log-entry');
    await expect(entries.filter({ hasText: me.name })).toContainText('1 h 30 min');
    await expect(entries.filter({ hasText: me.name })).toContainText('60,00 €');
    await add(bName, bratislavaDay(-1), '2h');
    await expect(entries.filter({ hasText: bName })).toContainText('100,00 €');

    // The summary and the month header sum both: 3 h 30 min, 160 €.
    await expect(log.getByTestId('work-log-summary')).toContainText('3 h 30 min');
    await expect(log.getByTestId('work-log-summary')).toContainText('160 €');

    // The overview's hours view: one chart per admin.
    const overview = page.getByRole('region', { name: 'Prehľad' });
    await overview.getByRole('radio', { name: 'Hodiny' }).click();
    await expect(
      overview.getByRole('group', { name: `Hodiny: ${me.name} po mesiacoch` }),
    ).toBeVisible();
    await expect(
      overview.getByRole('group', { name: `Hodiny: ${bName} po mesiacoch` }),
    ).toBeVisible();
    expect(b.id).toBeTruthy();
  });
});
