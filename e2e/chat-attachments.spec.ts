import { expect, test, type Locator, type Page } from '@playwright/test';

// Phase 34 (part P34-A, scenario 3): the attachment picker of a client's group chat has three
// tabs. The admin (signed in already, auth.setup.ts) attaches a task and a ticket of the group
// to a message; both cards show in a second tab over the socket, with the live state, and open
// the task panel and the ticket page. A ticket moved to another client turns into an
// "unavailable" card. (The requester's copy, which drops tasks and keeps only their own ticket,
// is covered by the server tests: it needs a second signed-in person.)

const KEY = 'e2e-tickets-key-0123456789';

const row = (page: Page, text: string): Locator =>
  page.locator('[data-message-id]').filter({ hasText: text });

test('a task and a ticket travel in a message as live cards', async ({ page, context }) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const host = `e2e-work-${stamp}.egrant.sk`;
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Práca ${stamp}`, egrantUrl: `https://${host}` },
  });
  expect(created.status()).toBe(201);
  const groupId = ((await created.json()) as { id: string }).id;
  const taskTitle = `E2E úloha ${stamp}`;
  const task = await page.request.post(`/api/groups/${groupId}/tasks`, {
    data: { title: taskTitle },
  });
  expect(task.status()).toBe(201);
  const subject = `E2E tiket ${stamp}`;
  const intake = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: {
      request_id: `e2e-work-${stamp}`,
      subject,
      email: `e2e-work-${stamp}@example.com`,
      instance_url: `https://${host}/app`,
    },
  });
  expect(intake.status()).toBe(201);
  const ticket = (await intake.json()) as { id: string; number: number };

  await page.goto(`/groups/${groupId}/chat`);
  const other = await context.newPage();
  await other.goto(`/groups/${groupId}/chat`);

  // The picker opens on Knowledge; the Tasks and Tickets tabs search their own lists.
  await page.getByRole('button', { name: 'Pridať', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Znalosti' }).click();
  const picker = page.getByTestId('attach-picker');
  await expect(picker.getByRole('tab')).toHaveCount(3);
  await picker.getByRole('tab', { name: 'Úlohy' }).click();
  await picker.getByRole('searchbox').fill('E2E úloha');
  await picker.getByRole('checkbox', { name: new RegExp(taskTitle) }).check();
  await picker.getByRole('tab', { name: /Tikety/ }).click();
  await picker.getByRole('searchbox').fill(`#${ticket.number}`);
  await picker.getByRole('checkbox', { name: new RegExp(subject) }).check();
  await picker.getByRole('button', { name: 'Priložiť (2)' }).click();

  const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill('Pozri úlohu a tiket');
  await box.press('Enter');
  for (const view of [page, other]) {
    const message = row(view, 'Pozri úlohu a tiket');
    await expect(message.getByRole('link', { name: new RegExp(taskTitle) })).toBeVisible();
    await expect(message.getByRole('link', { name: new RegExp(subject) })).toBeVisible();
  }

  // The cards open the task panel and the ticket page.
  await row(page, 'Pozri úlohu a tiket')
    .getByRole('link', { name: new RegExp(subject) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));

  // A ticket moved to another client is unavailable in this chat.
  const otherGroup = await page.request.post('/api/groups', {
    data: { name: `E2E Iná práca ${stamp}`, egrantUrl: `https://e2e-work2-${stamp}.egrant.sk` },
  });
  const otherId = ((await otherGroup.json()) as { id: string }).id;
  const moved = await page.request.put(`/api/tickets/${ticket.id}/group`, {
    data: { groupId: otherId },
  });
  expect(moved.ok()).toBe(true);
  await other.reload();
  await expect(row(other, 'Pozri úlohu a tiket').getByText('Tiket nie je dostupný')).toBeVisible();
});
