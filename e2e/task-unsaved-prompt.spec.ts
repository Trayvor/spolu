import { expect, test } from '@playwright/test';

// Closing an edited task asks first: the × at the prompt's top left (and Escape) return to
// editing; "Uložiť zmeny" saves and closes the panel; "Zahodiť" leaves without saving.
test('the task unsaved prompt: × and Escape keep editing, save closes, discard leaves', async ({
  page,
}) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Zatvoriť ${stamp}`, egrantUrl: `https://e2e-close-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  const make = async (title: string) => {
    const r = await page.request.post(`/api/groups/${group.id}/tasks`, { data: { title } });
    expect(r.status()).toBe(201);
    return ((await r.json()) as { id: string }).id;
  };
  const first = await make(`Prvá ${stamp}`);
  const second = await make(`Druhá ${stamp}`);

  const panel = page.getByRole('complementary', { name: 'Úloha' });
  const prompt = page.getByRole('alertdialog');
  const edit = async (id: string, suffix: string) => {
    await page.goto(`/groups/${group.id}/tasks/${id}`);
    await panel.getByLabel('Názov', { exact: true }).fill(suffix);
    await panel.getByRole('button', { name: 'Zavrieť' }).first().click();
    await expect(prompt).toBeVisible();
  };

  await edit(first, `Prvá ${stamp} upravená`);
  await prompt.getByRole('button', { name: 'Zavrieť' }).click();
  await expect(prompt).toHaveCount(0);
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Zavrieť' }).first().click();
  await expect(prompt.getByRole('button', { name: 'Zavrieť' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(prompt).toHaveCount(0);
  await expect(panel).toBeVisible();

  // Save changes: saved, and the panel closes.
  await panel.getByRole('button', { name: 'Zavrieť' }).first().click();
  await prompt.getByRole('button', { name: 'Uložiť zmeny' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('link', { name: `Prvá ${stamp} upravená` })).toBeVisible();

  // Discard: leaves, nothing saved.
  await edit(second, `Druhá ${stamp} zahodená`);
  await prompt.getByRole('button', { name: 'Zahodiť' }).click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByRole('link', { name: `Druhá ${stamp}`, exact: true })).toBeVisible();
});
