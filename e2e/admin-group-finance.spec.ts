import { expect, test } from '@playwright/test';

// Phase 34 P34-E (spec §10, scenario 7; reconciled with Phase 32 E): the superadmin (a finance
// admin) logs time on an "eGrant tím" task; its Financie tab is the organisation's (the
// Organizácia items card); `/finance` counts the internal time in every client by default and
// never ranks the admin group; unticking "eGrant tím" in the client filter leaves its hours out.
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
  for (const query of ['', '&internal=0', `&clients=${team}`]) {
    const res = await page.request.get(`/api/finance/rankings/hours?admin=${me.id}${query}`);
    expect(res.ok()).toBe(true);
    const rows = ((await res.json()) as { rows: { groupId: string | null }[] }).rows;
    expect(rows.map((r) => r.groupId)).not.toContain(team);
  }

  // `/finance`: the team is in "every client" by default (owner decision of 2026-10-18), so the
  // internal task is in the work log; unticking "eGrant tím" leaves its time out.
  await page.goto('/finance');
  const internalTask = page.getByRole('link', { name: `E2E interná úloha ${stamp}` });
  await expect(internalTask).toBeVisible();
  await page.getByRole('button', { name: 'Klienti: Všetci' }).first().click();
  const option = page.getByRole('checkbox', { name: 'eGrant tím' });
  await expect(option).toBeChecked();
  await option.uncheck();
  await expect(option).not.toBeChecked();
  await page.keyboard.press('Escape');
  await expect(internalTask).toHaveCount(0);
});
