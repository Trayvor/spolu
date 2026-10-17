import { expect, test } from '@playwright/test';

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
