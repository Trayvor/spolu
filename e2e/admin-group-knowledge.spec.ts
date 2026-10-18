import { expect, test } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

// Phase 34 P34-C (spec §10, scenario 5): an "Only eGrant" note of the admin group is not offered
// in a client's picker; marked "Shareable with clients" it is offered under "eGrant tím",
// attached in the client's chat the client opens it read-only with the badge; switched back,
// the card shows "Item unavailable". The admin is signed in already (auth.setup.ts).
test('an admin shares one internal note with a client chat on purpose', async ({
  page: admin,
  browser,
}) => {
  test.setTimeout(90_000);
  const stamp = Date.now();
  const groups = (await (await admin.request.get('/api/groups')).json()) as {
    id: string;
    kind: string;
  }[];
  const team = groups.find((g) => g.kind === 'admin')!.id;
  const title = `E2E interná metodika ${stamp}`;
  const created = await admin.request.post(`/api/groups/${team}/knowledge`, {
    data: { type: 'note', title, body: 'Postup pre klientov' },
  });
  expect(created.status()).toBe(201);
  const note = (await created.json()) as { id: string; visibility: string; updatedAt: string };
  expect(note.visibility).toBe('admins');

  // The client group and its client (through the invite link).
  const client = await admin.request.post('/api/groups', {
    data: { name: `E2E Zdieľanie ${stamp}`, egrantUrl: `https://e2e-share-${stamp}.egrant.sk` },
  });
  const groupId = ((await client.json()) as { id: string }).id;
  await admin.goto(`/groups/${groupId}/members`);
  const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
  const email = `e2e-share-${stamp}@example.com`;
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const clientPage = await context.newPage();
  await clientPage.goto(new URL(inviteUrl).pathname);
  await clearMailFor(context.request, email);
  await clientPage.getByLabel('E-mail').fill(email);
  await clientPage.getByRole('button', { name: 'Poslať kód' }).click();
  await clientPage.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await clientPage.getByLabel('Vaše meno').fill('E2E Klient');
  await clientPage.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(clientPage).toHaveURL(new RegExp(`/groups/${groupId}/chat$`));

  // "Only eGrant": not offered under "eGrant tím".
  await admin.goto(`/groups/${groupId}/chat`);
  await admin.getByRole('button', { name: 'Priložiť znalosť, úlohu alebo tiket' }).click();
  const picker = admin.getByTestId('attach-picker');
  await picker.getByRole('tab', { name: 'Znalosti' }).click();
  await picker.getByRole('radio', { name: 'eGrant tím' }).click();
  await picker.getByRole('searchbox').fill(`${stamp}`);
  await expect(picker.getByText('Hľadaniu nič nezodpovedá.')).toBeVisible();
  await admin.keyboard.press('Escape');

  // Marked "Shareable with clients": offered, attached and sent.
  const shared = await admin.request.patch(`/api/knowledge/${note.id}`, {
    data: { visibility: 'public', updatedAt: note.updatedAt },
  });
  expect(shared.status()).toBe(200);
  await admin.reload();
  await admin.getByRole('button', { name: 'Priložiť znalosť, úlohu alebo tiket' }).click();
  await picker.getByRole('tab', { name: 'Znalosti' }).click();
  await picker.getByRole('radio', { name: 'eGrant tím' }).click();
  await picker.getByRole('searchbox').fill(`${stamp}`);
  await picker.getByRole('checkbox', { name: new RegExp(title) }).check();
  await picker.getByRole('button', { name: 'Priložiť (1)' }).click();
  const box = admin.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill(`Metodika ${stamp}`);
  await box.press('Enter');

  // The client sees the card with the badge and opens it read-only.
  await clientPage.goto(`/groups/${groupId}/chat`);
  const message = clientPage.locator('[data-message-id]').filter({ hasText: `Metodika ${stamp}` });
  const card = message.getByRole('button', { name: new RegExp(title) });
  await expect(card).toBeVisible();
  await expect(card.getByText('eGrant tím')).toBeVisible();
  await card.click();
  const dialog = clientPage.getByTestId('shared-knowledge-dialog');
  await expect(dialog.getByRole('heading', { name: title })).toBeVisible();
  await expect(dialog.getByText('Postup pre klientov')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Upraviť' })).toHaveCount(0);
  await clientPage.keyboard.press('Escape');

  // Switched back to "Only eGrant": the card is unavailable.
  const latest = (await (await admin.request.get(`/api/knowledge/${note.id}`)).json()) as {
    updatedAt: string;
  };
  const back = await admin.request.patch(`/api/knowledge/${note.id}`, {
    data: { visibility: 'admins', updatedAt: latest.updatedAt },
  });
  expect(back.status()).toBe(200);
  await clientPage.reload();
  await expect(message.getByText('Položka nie je dostupná')).toBeVisible();
  await context.close();
});
