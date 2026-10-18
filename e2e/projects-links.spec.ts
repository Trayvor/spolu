import { expect, test, type BrowserContext } from '@playwright/test';

// Phase 33 part P2 (spec §14, scenario 2 without the timeline, which is part P4's): a task and a
// ticket on an event, and both tabs filtered by the project and the event.

test.describe.serial('projects: tasks and tickets on events (P2)', () => {
  const stamp = Date.now();
  let admin: BrowserContext;
  let groupId = '';
  let projectId = '';
  let eventId = '';
  const projectName = `Kultúra ${stamp}`;

  test.beforeAll(async ({ browser }) => {
    admin = await browser.newContext({
      locale: 'sk-SK',
      storageState: 'e2e/.auth/superadmin.json',
    });
    const api = admin.request;
    const group = await api.post('/api/groups', {
      data: { name: `E2E Väzby ${stamp}`, egrantUrl: `https://e2e-links-${stamp}.egrant.sk` },
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
    for (const title of ['Rozpočet', 'Iná úloha']) {
      expect((await api.post(`/api/groups/${groupId}/tasks`, { data: { title } })).status()).toBe(
        201,
      );
    }
  });
  test.afterAll(async () => {
    await admin.close();
  });

  test('the admin puts a task on the event; the board filtered by it shows only that task', async () => {
    const page = await admin.newPage();
    await page.goto(`/groups/${groupId}/tasks`);
    await page
      .getByRole('link', { name: /Rozpočet/ })
      .first()
      .click();
    const panel = page.getByTestId('task-panel');
    await panel.getByRole('combobox', { name: 'Projekt' }).selectOption({ label: projectName });
    await panel.getByRole('combobox', { name: 'Udalosť' }).selectOption(eventId);
    await panel.getByRole('button', { name: 'Uložiť zmeny' }).click();
    await expect(panel.getByRole('button', { name: 'Uložiť zmeny' })).toHaveCount(0);
    await page.goto(`/groups/${groupId}/tasks?project=${projectId}&event=${eventId}`);
    await expect(page.getByRole('link', { name: /Rozpočet/ }).first()).toBeVisible();
    await expect(page.getByRole('link', { name: /Iná úloha/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Udalosť: Hodnotenie/ }).first()).toBeVisible();
    await page.close();
  });

  test('the ticket page sets the event; the Tickets tab filters by it', async () => {
    const api = admin.request;
    const created = await api.post('/api/tickets', {
      data: { groupId, subject: `Otázka ${stamp}` },
    });
    const ticket = (await created.json()) as { id: string };
    await api.post('/api/tickets', { data: { groupId, subject: `Iná ${stamp}` } });
    const page = await admin.newPage();
    await page.goto(`/tickets/${ticket.id}`);
    await page.getByRole('combobox', { name: 'Projekt' }).selectOption({ label: projectName });
    const event = page.getByRole('combobox', { name: 'Udalosť' });
    await event.selectOption(eventId);
    await expect(event).toHaveValue(eventId);
    await expect
      .poll(
        async () =>
          (
            (await (await api.get(`/api/tickets/${ticket.id}`)).json()) as {
              event: { id: string } | null;
            }
          ).event?.id,
      )
      .toBe(eventId);
    await page.goto(`/groups/${groupId}/tickets?project=${projectId}&event=${eventId}`);
    await expect(page.getByText(`Otázka ${stamp}`)).toBeVisible();
    await expect(page.getByText(`Iná ${stamp}`)).toHaveCount(0);
    await page.close();
  });
});
