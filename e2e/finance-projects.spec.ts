import { expect, test } from '@playwright/test';

// Phase 33 spec §14 scenario 9, "Finance filter" (part P6): a finance admin (the superadmin,
// owner decision 1 of Phase 32) filters a client's work log by a project: only that project's
// entries and totals remain. The time comes from manual entries through the API.

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
  new Date(),
);

test('the work log filtered by a project keeps only its entries and totals', async ({ page }) => {
  const stamp = Date.now();
  const me = (await (await page.request.get('/api/me')).json()) as { id: string; name: string };
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Projekty ${stamp}`, egrantUrl: `https://e2e-fin-p-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const groupId = ((await created.json()) as { id: string }).id;
  const project = await page.request.post(`/api/groups/${groupId}/projects`, {
    data: { name: `Kultúra ${stamp}`, description: '', fileIds: [] },
  });
  expect(project.status()).toBe(201);
  const projectId = ((await project.json()) as { id: string }).id;
  for (const [minutes, note, pair] of [
    [90, `Na projekte ${stamp}`, { projectId }],
    [45, `Mimo projektu ${stamp}`, {}],
  ] as const) {
    const res = await page.request.post(`/api/groups/${groupId}/finance/time-entries`, {
      data: { userId: me.id, workedOn: today, minutes, note, ...pair },
    });
    expect(res.status()).toBe(201);
  }

  await page.goto(`/groups/${groupId}/finance`);
  const log = page.getByRole('region', { name: 'Výkaz práce' });
  const entries = log.getByTestId('work-log-entry');
  await expect(entries).toHaveCount(2);
  await expect(log.getByTestId('work-log-summary')).toContainText('2 h 15 min');

  await log.getByRole('button', { name: /^Projekt: / }).click();
  await page.getByRole('menuitemradio', { name: `Kultúra ${stamp}` }).click();
  await expect(log.getByRole('button', { name: `Projekt: Kultúra ${stamp}` })).toBeVisible();
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText(`Na projekte ${stamp}`);
  await expect(log.getByTestId('work-log-summary')).toContainText('1 h 30 min');

  await log.getByRole('button', { name: /^Projekt: / }).click();
  await page.getByRole('menuitemradio', { name: 'Bez projektu' }).click();
  await expect(entries).toHaveCount(1);
  await expect(entries.first()).toContainText(`Mimo projektu ${stamp}`);
  await expect(log.getByTestId('work-log-summary')).toContainText('45 min');
});
