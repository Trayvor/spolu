import { expect, test, type BrowserContext } from '@playwright/test';

// 2026-10-19 (owner bug): on the group board "Zrušiť filtre" and "Akýkoľvek" for the Project
// and the Event did nothing (the route retains its filter params, and a deleted one came back).
// Also the board's Assignee filter (owner request, the same day).

test.describe.serial('group board filters: Any, Assignee and Clear filters', () => {
  const stamp = Date.now();
  let admin: BrowserContext;
  let groupId = '';
  let projectId = '';
  let eventId = '';
  const projectName = `Filtre ${stamp}`;

  test.beforeAll(async ({ browser }) => {
    admin = await browser.newContext({
      locale: 'sk-SK',
      storageState: 'e2e/.auth/superadmin.json',
    });
    const api = admin.request;
    const me = (await (await api.get('/api/me')).json()) as { id: string };
    const group = await api.post('/api/groups', {
      data: { name: `E2E Filtre ${stamp}`, egrantUrl: `https://e2e-filters-${stamp}.egrant.sk` },
    });
    expect(group.status()).toBe(201);
    groupId = ((await group.json()) as { id: string }).id;
    const project = await api.post(`/api/groups/${groupId}/projects`, {
      data: { name: projectName },
    });
    projectId = ((await project.json()) as { id: string }).id;
    const event = await api.post(`/api/projects/${projectId}/events`, {
      data: { name: 'Hodnotenie', occursOn: `${new Date().getFullYear() + 1}-11-04` },
    });
    eventId = ((await event.json()) as { id: string }).id;
    const tasks = [
      { title: 'Na udalosti', projectId, eventId, assigneeIds: [me.id] },
      { title: 'Bez projektu' },
    ];
    for (const data of tasks) {
      expect((await api.post(`/api/groups/${groupId}/tasks`, { data })).status()).toBe(201);
    }
  });
  test.afterAll(async () => {
    await admin.close();
  });

  test('Any clears the event and the project, Me filters, Clear filters resets all', async () => {
    const page = await admin.newPage();
    const onEvent = page.getByRole('link', { name: /Na udalosti/ }).first();
    const other = page.getByRole('link', { name: /Bez projektu/ }).first();
    const search = () => new URL(page.url()).searchParams;
    const choose = async (pill: RegExp, item: string) => {
      await page.getByRole('button', { name: pill }).first().click();
      await page.getByRole('menuitemradio', { name: item, exact: true }).click();
    };

    await page.goto(`/groups/${groupId}/tasks?project=${projectId}&event=${eventId}`);
    await expect(onEvent).toBeVisible();
    await expect(other).toHaveCount(0);

    await choose(/Udalosť: Hodnotenie/, 'Akýkoľvek');
    await expect.poll(() => search().has('event')).toBe(false);
    expect(search().get('project')).toBe(projectId);
    await expect(page.getByRole('button', { name: 'Udalosť: Akýkoľvek' })).toBeVisible();

    await choose(new RegExp(`Projekt: ${projectName}`), 'Akýkoľvek');
    await expect.poll(() => search().has('project')).toBe(false);
    await expect(other).toBeVisible();
    await expect(onEvent).toBeVisible();

    await choose(/Riešiteľ: Ktokoľvek/, 'Ja');
    await expect.poll(() => search().get('assignee')).toBe('me');
    await expect(other).toHaveCount(0);
    await expect(onEvent).toBeVisible();

    await page.getByRole('button', { name: 'Zrušiť filtre' }).click();
    await expect.poll(() => search().toString()).toBe('');
    await expect(other).toBeVisible();
    await expect(page.getByRole('button', { name: 'Zrušiť filtre' })).toHaveCount(0);

    // The cleared filters are not remembered: the next visit is unfiltered.
    await page.goto(`/groups/${groupId}/tasks`);
    await expect(other).toBeVisible();
    expect(search().toString()).toBe('');
    await page.close();
  });
});
