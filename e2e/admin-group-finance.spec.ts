import { expect, test } from '@playwright/test';

// Phase 34 P34-E (spec §10, scenario 7; reconciled with Phase 32 E): the superadmin (a finance
// admin) logs time on an "eGrant tím" task; its Financie tab is the organisation's (the
// Organizácia items card); `/finance` leaves the internal time out of every client and never
// ranks the admin group; choosing "eGrant tím" in the client filter brings its hours in.
test('finance in the admin group: internal time, the organisation tab, never ranked', async ({
  page,
}) => {
  const stamp = Date.now();
  const me = (await (await page.request.get('/api/me')).json()) as { id: string };
  const groups = (await (await page.request.get('/api/groups')).json()) as {
    id: string;
    kind: string;
  }[];
  const team = groups.find((g) => g.kind === 'admin')!.id;

  // A done task of the admin group, with 75 minutes of the superadmin's time.
  const board = (await (await page.request.get(`/api/groups/${team}/board`)).json()) as {
    buckets: { id: string; kind: string }[];
  };
  const created = await page.request.post(`/api/groups/${team}/tasks`, {
    data: {
      title: `E2E interná úloha ${stamp}`,
      description: '',
      assigneeIds: [me.id],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
      bucketId: board.buckets.find((b) => b.kind === 'done')!.id,
    },
  });
  expect(created.status()).toBe(201);
  const task = (await created.json()) as { id: string };
  expect(
    (await page.request.put(`/api/tasks/${task.id}/time/me`, { data: { minutes: 75 } })).ok(),
  ).toBe(true);

  // The tab: the organisation's items card, the internal time in the work log.
  await page.goto(`/groups/${team}/finance`);
  await expect(page.getByRole('heading', { name: 'Organizácia' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Prehľad', exact: true })).toBeVisible();

  // The rankings never list it, whatever the filter.
  for (const query of ['', '&internal=1', `&clients=${team}`]) {
    const res = await page.request.get(`/api/finance/rankings/hours?admin=${me.id}${query}`);
    expect(res.ok()).toBe(true);
    const rows = ((await res.json()) as { rows: { groupId: string | null }[] }).rows;
    expect(rows.map((r) => r.groupId)).not.toContain(team);
  }

  // `/finance`: the option is off by default and the internal task is not in the work log;
  // ticking "eGrant tím" brings its time in.
  await page.goto('/finance');
  const internalTask = page.getByRole('link', { name: `E2E interná úloha ${stamp}` });
  await expect(page.getByRole('heading', { name: 'Výkaz práce' })).toBeVisible();
  await expect(internalTask).toHaveCount(0);
  await page.getByRole('button', { name: 'Klienti: Všetci' }).first().click();
  const option = page.getByRole('checkbox', { name: 'eGrant tím' });
  await expect(option).not.toBeChecked();
  await option.check();
  await expect(option).toBeChecked();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('list', { name: 'Vybraní klienti' })).toContainText('eGrant tím');
  await expect(internalTask).toBeVisible();
});
