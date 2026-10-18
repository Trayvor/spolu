import { expect, test } from '@playwright/test';

// Phase 34 P34-D (spec §10, scenario 4): in "eGrant tím" the attachment picker lists every
// client's work. The admin (signed in already, auth.setup.ts) manages client X: X is marked as
// theirs in the client filter; they attach X's ticket and Y's admins-only note, and the cards
// name their clients. (A second admin opening both is covered by the server tests.)

const KEY = 'e2e-tickets-key-0123456789';

test('the admin group attaches another client’s ticket and admins-only note', async ({ page }) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const hostX = `e2e-pick-x-${stamp}.egrant.sk`;
  const group = async (name: string, host: string) => {
    const res = await page.request.post('/api/groups', {
      data: { name, egrantUrl: `https://${host}` },
    });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { id: string }).id;
  };
  const nameX = `E2E Klient X ${stamp}`;
  const nameY = `E2E Klient Y ${stamp}`;
  const x = await group(nameX, hostX);
  const y = await group(nameY, `e2e-pick-y-${stamp}.egrant.sk`);
  expect((await page.request.put(`/api/groups/${x}/managers/me`)).ok()).toBe(true);

  const subject = `E2E tiket X ${stamp}`;
  const intake = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: {
      request_id: `e2e-pick-${stamp}`,
      subject,
      email: `e2e-pick-${stamp}@example.com`,
      instance_url: `https://${hostX}/app`,
    },
  });
  expect(intake.status()).toBe(201);
  const ticket = (await intake.json()) as { number: number };
  const noteTitle = `E2E interná poznámka ${stamp}`;
  const note = await page.request.post(`/api/groups/${y}/knowledge`, {
    data: { type: 'note', title: noteTitle, body: 'Len pre nás', visibility: 'admins' },
  });
  expect(note.status()).toBe(201);

  const groups = (await (await page.request.get('/api/groups')).json()) as {
    id: string;
    kind: string;
  }[];
  const adminGroup = groups.find((g) => g.kind === 'admin')!.id;
  await page.goto(`/groups/${adminGroup}/chat`);

  await page.getByRole('button', { name: 'Priložiť znalosť, úlohu alebo tiket' }).click();
  const picker = page.getByTestId('attach-picker');

  // Knowledge: every client's items, an admins-only one marked "Len eGrant", with its client.
  await picker.getByRole('tab', { name: 'Znalosti' }).click();
  await picker.getByRole('searchbox').fill(noteTitle);
  const noteRow = picker.locator('label').filter({ hasText: noteTitle });
  await expect(noteRow).toContainText('Len eGrant');
  await expect(noteRow).toContainText(nameY);
  await noteRow.getByRole('checkbox').check();

  // Tickets: X sits under "Spravujete vy" with the dot; "Len moji klienti" keeps X's ticket.
  await picker.getByRole('tab', { name: /Tikety/ }).click();
  await picker.getByRole('button', { name: 'Klienti: Všetci' }).click();
  const panel = page.getByRole('dialog', { name: 'Klienti' });
  await panel.getByRole('searchbox', { name: 'Nájsť klienta' }).fill(nameX);
  const mine = panel.getByRole('group', { name: 'Spravujete vy' });
  await expect(
    mine.locator('label').filter({ hasText: nameX }).locator('[data-managed-dot]'),
  ).toHaveCount(1);
  await panel.getByRole('button', { name: 'Len moji klienti' }).click();
  await panel.getByRole('button', { name: 'Hotovo' }).click();
  await picker.getByRole('searchbox').fill(`#${ticket.number}`);
  const ticketRow = picker.locator('label').filter({ hasText: subject });
  await expect(ticketRow).toContainText(nameX);
  await ticketRow.getByRole('checkbox').check();
  await picker.getByRole('button', { name: 'Priložiť (2)' }).click();

  const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill(`Pozrite ${stamp}`);
  await box.press('Enter');
  const message = page.locator('[data-message-id]').filter({ hasText: `Pozrite ${stamp}` });
  const card = message.getByRole('link', { name: new RegExp(subject) });
  await expect(card).toBeVisible();
  await expect(card).toContainText(nameX);
  await expect(message.getByText(noteTitle)).toBeVisible();
});
