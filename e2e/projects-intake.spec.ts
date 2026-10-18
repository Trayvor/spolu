import { expect, test, type APIRequestContext } from '@playwright/test';

// Phase 33 part P3, spec §14 scenarios 3–5: eGrant projects through their endpoint, the ticket
// intake's project_id, the review of changes from eGrant, and merge. The admin's session is the
// default state; eGrant's calls carry the shared key.
const KEY = 'e2e-tickets-key-0123456789';
const auth = { authorization: `Bearer ${KEY}` };

type Event = { name: string; date: string; description?: string };
const deliver = (
  request: APIRequestContext,
  host: string,
  id: string,
  body: { name?: string; events: Event[]; sent_at?: string },
) =>
  request.put(`/api/egrant/projects/${id}`, {
    headers: auth,
    data: {
      instance_url: `https://${host}`,
      sent_at: body.sent_at ?? '2026-10-17T10:00:00+02:00',
      name: body.name ?? 'Kultúra 2026',
      description: 'Grant na kultúru',
      events: body.events,
    },
  });
const intake = (request: APIRequestContext, host: string, data: object) =>
  request.post('/api/tickets/intake', {
    headers: auth,
    data: { subject: 'Otázka k projektu', instance_url: `https://${host}`, ...data },
  });

test.describe.serial('eGrant projects (P3)', () => {
  const stamp = Date.now();
  const host = `e2e-intake-${stamp}.egrant.sk`;
  const p208 = `prj-208-${stamp}`;
  const p209 = `prj-209-${stamp}`;
  const p300 = `prj-300-${stamp}`;
  const events: Event[] = [
    { name: 'Hodnotenie', date: '04.11.2026' },
    { name: 'Uzávierka', date: '20.12.2026' },
    { name: 'Neplatná', date: '31.02.2026' },
  ];
  let groupId = '';
  let projectId = '';

  test('a delivery for an unknown instance is stored and becomes the project with its client', async ({
    page,
  }) => {
    const stored = await deliver(page.request, host, p208, { events });
    expect(stored.status()).toBe(202);
    expect(await stored.json()).toEqual({ project_id: p208, state: 'stored' });

    const group = await page.request.post('/api/groups', {
      data: { name: `E2E eGrant ${stamp}`, egrantUrl: `https://${host}` },
    });
    expect(group.status()).toBe(201);
    groupId = ((await group.json()) as { id: string }).id;

    // Delivered again now that the client exists: the stored one already made the project.
    const again = await deliver(page.request, host, p208, { events });
    expect(again.status()).toBe(200);
    expect(await again.json()).toMatchObject({ state: 'unchanged', skipped: ['events[2].date'] });

    await page.goto(`/groups/${groupId}/overview`);
    const card = page.getByRole('region', { name: 'Projekty' });
    const row = card.getByRole('button', { name: /Kultúra 2026/ });
    await expect(row).toContainText('Z eGrantu');
    await row.click();
    const sheet = page.getByTestId('project-sheet');
    await expect(sheet.getByText('Hodnotenie')).toBeVisible();
    await expect(sheet.getByText('Uzávierka')).toBeVisible();
    await expect(sheet.getByText('Neplatná')).toHaveCount(0);
    const picker = await page.request.get(`/api/groups/${groupId}/projects/picker`);
    projectId = ((await picker.json()) as { id: string }[])[0]!.id;
  });

  test('tickets with project_id land in the project; an unknown one waits until it arrives', async ({
    page,
  }) => {
    const known = await intake(page.request, host, { project_id: p208 });
    expect(known.status()).toBe(201);
    const knownId = ((await known.json()) as { id: string }).id;
    const dto = await (await page.request.get(`/api/tickets/${knownId}`)).json();
    expect(dto).toMatchObject({ waitingForProject: false, egrantProjectId: p208, event: null });

    const waiting = await intake(page.request, host, { project_id: p300 });
    const waitingId = ((await waiting.json()) as { id: string }).id;
    await page.goto(`/tickets/${waitingId}`);
    await expect(page.getByText(`Projekt ${p300} z eGrantu ešte neprišiel.`)).toBeVisible();

    const arrived = await deliver(page.request, host, p300, {
      name: 'Šport 2027',
      events: [],
    });
    expect(arrived.status()).toBe(201);
    await page.reload();
    await expect(page.getByText(`Projekt ${p300} z eGrantu ešte neprišiel.`)).toHaveCount(0);

    const none = await intake(page.request, host, {});
    const noneDto = await (
      await page.request.get(`/api/tickets/${((await none.json()) as { id: string }).id}`)
    ).json();
    expect(noneDto).toMatchObject({ egrantProjectId: null, waitingForProject: false });
  });

  test('a later delivery becomes changes reviewed field by field', async ({ page }) => {
    const later = await deliver(page.request, host, p208, {
      sent_at: '2026-10-18T10:00:00+02:00',
      name: 'Kultúra 2026 – nová',
      events: [
        { name: 'Hodnotenie', date: '06.11.2026' }, // redate (paired by name)
        { name: 'Záverečná uzávierka', date: '20.12.2026' }, // rename (paired by date)
        { name: 'Workshop', date: '15.01.2027' }, // addition
      ],
    });
    expect(later.status()).toBe(200);
    expect(await later.json()).toMatchObject({ state: 'pending', pending: 4 });

    await page.goto(`/groups/${groupId}/overview?sheet=${projectId}`);
    const section = page.getByRole('region', { name: 'Zmeny z eGrantu (4)' });
    await expect(section).toBeVisible();
    const rows = section.getByRole('listitem');
    await rows
      .filter({ hasText: 'Názov projektu' })
      .getByRole('button', { name: 'Prijať' })
      .click();
    await rows
      .filter({ hasText: 'Hodnotenie: dátum' })
      .getByRole('button', { name: 'Prijať' })
      .click();
    await rows
      .filter({ hasText: 'Nová udalosť' })
      .getByRole('button', { name: 'Zamietnuť' })
      .click();
    await section.getByRole('button', { name: 'Uložiť výber' }).click();
    await expect(page.getByRole('region', { name: 'Zmeny z eGrantu (1)' })).toBeVisible();
    await expect(page.getByTestId('project-sheet').getByText('Kultúra 2026 – nová')).toBeVisible();

    // The same delivery again raises nothing new: the dismissed addition stays dismissed.
    const same = await deliver(page.request, host, p208, {
      sent_at: '2026-10-18T10:00:00+02:00',
      name: 'Kultúra 2026 – nová',
      events: [
        { name: 'Hodnotenie', date: '06.11.2026' },
        { name: 'Záverečná uzávierka', date: '20.12.2026' },
        { name: 'Workshop', date: '15.01.2027' },
      ],
    });
    expect(await same.json()).toMatchObject({ pending: 1 });
  });

  test('a duplicate merges into the project; its eGrant id keeps matching the survivor', async ({
    page,
  }) => {
    expect(
      (
        await deliver(page.request, host, p209, {
          name: 'Kultúra 2026 (2)',
          events: [{ name: 'Seminár', date: '10.03.2027' }],
        })
      ).status(),
    ).toBe(201);
    const ticket = await intake(page.request, host, { project_id: p209 });
    const ticketId = ((await ticket.json()) as { id: string }).id;

    await page.goto(`/groups/${groupId}/overview`);
    await page
      .getByRole('region', { name: 'Projekty' })
      .getByRole('button', { name: /Kultúra 2026 \(2\)/ })
      .click();
    const sheet = page.getByTestId('project-sheet');
    await sheet.getByRole('button', { name: 'Akcie projektu' }).click();
    await page.getByRole('menuitem', { name: 'Zlúčiť do…' }).click();
    await sheet.getByRole('combobox').selectOption(projectId);
    await sheet.getByRole('button', { name: 'Zlúčiť', exact: true }).click();
    await expect(sheet).toHaveCount(0);

    const moved = await (await page.request.get(`/api/tickets/${ticketId}`)).json();
    expect(moved.egrantProjectId).toBe(p209);
    const next = await intake(page.request, host, { project_id: p209 });
    const nextId = ((await next.json()) as { id: string }).id;
    expect(
      (await (await page.request.get(`/api/tickets/${nextId}`)).json()).waitingForProject,
    ).toBe(false);
    const later = await deliver(page.request, host, p209, {
      name: 'Kultúra 2026 (2)',
      events: [{ name: 'Seminár', date: '10.03.2027' }],
    });
    expect(later.status()).toBe(200);
    expect(await later.json()).toMatchObject({ state: 'pending' });
  });
});
