import { expect, test, type Locator, type Page } from '@playwright/test';
import type { KnowledgeItemDto } from '@spolu/shared';

// Phase 28 (reactions and attached knowledge items): an admin reacts to a message and a second
// tab of theirs sees the chip arrive over the socket; they attach a public note from the
// knowledge base, open it from the card, and after it turns admins-only the card says it is
// unavailable. The superadmin is signed in already (auth.setup.ts), so no login code is needed.

/** A message row, found by its text. */
const row = (page: Page, text: string): Locator =>
  page.locator('[data-message-id]').filter({ hasText: text });

test('reactions arrive live and a knowledge item travels in a message', async ({
  page,
  context,
}) => {
  test.setTimeout(60_000);
  const stamp = Date.now();
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Reakcie ${stamp}`, egrantUrl: `https://e2e-react-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const groupId = ((await created.json()) as { id: string }).id;
  const noteRes = await page.request.post(`/api/groups/${groupId}/knowledge`, {
    data: { type: 'note', title: `E2E návod ${stamp}`, body: 'Krok jedna, krok dva.' },
  });
  expect(noteRes.status()).toBe(201);
  const note = (await noteRes.json()) as KnowledgeItemDto;

  await page.goto(`/groups/${groupId}/chat`);
  const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill('Ahoj reakcie');
  await box.press('Enter');
  const message = row(page, 'Ahoj reakcie');
  await expect(message).toBeVisible();

  const other = await context.newPage();
  await other.goto(`/groups/${groupId}/chat`);
  await expect(row(other, 'Ahoj reakcie')).toBeVisible();

  // The hover toolbar's "Add reaction" opens the quick row.
  await message.hover();
  await message.getByRole('button', { name: 'Pridať reakciu' }).click();
  await page.getByRole('menuitem', { name: 'Reagovať 👍' }).click();
  const mine = 'Reakcia 👍, spolu 1, vrátane vašej';
  await expect(message.getByRole('button', { name: mine })).toHaveAttribute('aria-pressed', 'true');
  // The other tab gets it over the socket, without a reload.
  await expect(row(other, 'Ahoj reakcie').getByRole('button', { name: mine })).toBeVisible();

  // A tap on the chip takes it back, in both tabs.
  await message.getByRole('button', { name: mine }).click();
  await expect(row(other, 'Ahoj reakcie').getByRole('button', { name: /Reakcia 👍/ })).toHaveCount(
    0,
  );

  // Attach the note from the knowledge base and send it with a line of text.
  await page.getByRole('button', { name: 'Priložiť znalosť, úlohu alebo tiket' }).click();
  const picker = page.getByTestId('attach-picker');
  await picker.getByRole('checkbox', { name: new RegExp(`E2E návod ${stamp}`) }).check();
  await picker.getByRole('button', { name: 'Priložiť (1)' }).click();
  await box.fill('Pozri návod');
  await box.press('Enter');
  const card = row(page, 'Pozri návod').getByRole('button', { name: new RegExp(note.title) });
  await expect(card).toBeVisible();
  await expect(
    row(other, 'Pozri návod').getByRole('button', { name: new RegExp(note.title) }),
  ).toBeVisible();

  // The card opens the item.
  await card.click();
  const dialog = page.getByTestId('knowledge-dialog');
  await expect(dialog.getByRole('heading', { name: note.title })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  // Made admins-only, the item is unavailable in the chat for everyone.
  const patched = await page.request.patch(`/api/knowledge/${note.id}`, {
    data: { visibility: 'admins', updatedAt: note.updatedAt },
  });
  expect(patched.status()).toBe(200);
  await other.reload();
  await expect(row(other, 'Pozri návod').getByText('Položka nie je dostupná')).toBeVisible();
});
