import { expect, test } from '@playwright/test';

// 2026-10-21: automatic assignees by area. An admin fills the client's table in the Tickets
// tab; a ticket from eGrant whose area matches (prefix, case and diacritics ignored) is assigned.
const KEY = 'e2e-tickets-key-0123456789';

test('an admin maps an area to themselves; a matching eGrant ticket is assigned to them', async ({
  page,
}) => {
  const stamp = Date.now();
  const host = `e2e-areas-${stamp}.egrant.sk`;
  const name = `E2E Oblasti ${stamp}`;
  const me = (await (await page.request.get('/api/me')).json()) as {
    id: string;
    name: string;
    email: string;
  };

  // The client, made through the API as an admin would in the app.
  const made = await page.request.post('/api/groups', {
    data: { name, egrantUrl: `https://${host}` },
  });
  expect(made.status()).toBe(201);
  const { id: groupId } = (await made.json()) as { id: string };

  await page.goto(`/groups/${groupId}/tickets`);
  await page.getByRole('button', { name: 'Automatické priraďovanie riešiteľov' }).click();
  const dialog = page.getByTestId('area-rules');
  await expect(dialog.getByText('Zatiaľ žiadne riadky.', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Pridať riadok' }).click();
  await dialog.getByRole('textbox', { name: 'Oblasť otázky, riadok 1' }).fill('zend.Žiadosti');
  await dialog
    .getByRole('combobox', { name: 'Riešiteľ, riadok 1' })
    .selectOption({ label: me.name || me.email });
  await dialog.getByRole('button', { name: 'Uložiť' }).click();
  await expect(dialog).toHaveCount(0);

  // Reopened: the row is there.
  await page.getByRole('button', { name: 'Automatické priraďovanie riešiteľov' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Oblasť otázky, riadok 1' })).toHaveValue(
    'zend.Žiadosti',
  );
  await dialog.getByRole('button', { name: 'Zrušiť' }).click();

  // eGrant sends a ticket of that area, spelled differently.
  const res = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: { subject: `Automaticky ${stamp}`, area: ' ziadosti ', instance_url: `https://${host}` },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const dto = (await (await page.request.get(`/api/tickets/${id}`)).json()) as {
    assignees: { id: string }[];
  };
  expect(dto.assignees.map((a) => a.id)).toEqual([me.id]);

  await page.goto(`/tickets/${id}`);
  await expect(page.getByText('Riešitelia (1)')).toBeVisible();
});
