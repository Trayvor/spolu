import { expect, test, type Page } from '@playwright/test';

// The fake AI (AI_PROVIDER=fake, set in playwright.config.ts) turns each "- " line into one card.

async function newGroup(page: Page, label: string) {
  const stamp = Date.now();
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E ${label} ${stamp}`, egrantUrl: `https://e2e-${label}-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  return (await created.json()) as { id: string; name: string };
}

test('a text pasted on the client board becomes reviewed tasks in the chosen column', async ({
  page,
}) => {
  const group = await newGroup(page, 'gentext');
  await page.goto(`/groups/${group.id}/tasks`);
  await page.getByRole('button', { name: 'Vygenerovať úlohy z textu' }).click();

  const input = page.getByRole('dialog', { name: 'Vygenerovať úlohy z textu' });
  await input.getByLabel('Text', { exact: true }).fill('- Prepare the budget\n- Book the venue');
  await input.getByRole('button', { name: 'Vygenerovať', exact: true }).click();

  const review = page.getByRole('dialog', { name: 'Vytvoriť úlohy' });
  await expect(review.getByRole('article')).toHaveCount(2);
  await review.getByRole('button', { name: 'Schváliť všetky' }).click();
  await review.getByRole('button', { name: 'Vytvoriť 2 úlohy' }).click();
  await expect(page.getByText('2 úlohy vytvorené')).toBeVisible();

  const todo = page.getByRole('region', { name: 'Na spracovanie' });
  await expect(todo.getByRole('link').filter({ hasNotText: 'Pridať úlohu' })).toHaveText([
    /Prepare the budget/,
    /Book the venue/,
  ]);
});

test('on the global board the client is chosen first', async ({ page }) => {
  const group = await newGroup(page, 'gentextglobal');
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Vygenerovať úlohy z textu' }).click();

  const input = page.getByRole('dialog', { name: 'Vygenerovať úlohy z textu' });
  await input.getByLabel('Text', { exact: true }).fill('- Send the contract');
  await expect(input.getByRole('button', { name: 'Vygenerovať', exact: true })).toBeDisabled();
  await input
    .getByRole('combobox', { name: 'Klient', exact: true })
    .selectOption({ label: group.name });
  await input.getByRole('button', { name: 'Vygenerovať', exact: true }).click();

  const review = page.getByRole('dialog', { name: 'Vytvoriť úlohy' });
  await expect(review.getByRole('article', { name: 'Send the contract' })).toBeVisible();
  await review.getByRole('button', { name: 'Schváliť všetky' }).click();
  await review.getByRole('button', { name: 'Vytvoriť 1 úlohu' }).click();
  await expect(page.getByText('1 úloha vytvorená')).toBeVisible();

  await page.goto(`/groups/${group.id}/tasks`);
  await expect(
    page.getByRole('region', { name: 'Na spracovanie' }).getByRole('link', {
      name: /Send the contract/,
    }),
  ).toBeVisible();
});
