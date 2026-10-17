import { expect, test, type Page } from '@playwright/test';

const KEY = 'e2e-tickets-key-0123456789';

async function createGroup(page: Page, name: string, egrantUrl: string): Promise<void> {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Vytvoriť skupinu' }).first().click();
  await page.getByLabel('Názov').fill(name);
  await page.getByLabel('Adresa klienta v eGrant').fill(egrantUrl);
  await page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(page.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
}

// Phase 29: an admin opens a ticket in Claude with optional notes. No request reaches claude.ai.
test('an admin generates the prompt for a ticket and opens it in Claude', async ({
  page,
  context,
}) => {
  await context.route('https://claude.ai/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Claude</title>' }),
  );
  const stamp = Date.now();
  const host = `e2e-claude-${stamp}.egrant.sk`;
  await createGroup(page, `E2E Claude ${stamp}`, `https://${host}`);
  const res = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: {
      subject: `Chýba termín ${stamp}`,
      body: 'Program nemá uzávierku.',
      instance_url: `https://${host}`,
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };

  await page.goto(`/tickets/${id}`);
  await page.getByRole('button', { name: 'Vyriešiť s Claude' }).click();
  const dialog = page.getByTestId('solve-with-claude');
  const notes = dialog.getByRole('textbox', { name: 'Poznámky pre Claude (nepovinné)' });
  await expect(notes).toHaveValue('');
  await notes.fill('Pozri program Šport.');
  await dialog.getByRole('button', { name: 'Vygenerovať' }).click();
  await expect(dialog.getByRole('heading', { name: 'Prompt je pripravený' })).toBeVisible();

  const [claude] = await Promise.all([
    context.waitForEvent('page'),
    dialog.getByRole('button', { name: 'Otvoriť v Claude' }).click(),
  ]);
  const url = new URL(claude.url());
  expect(url.origin + url.pathname).toBe('https://claude.ai/new');
  const prompt = url.searchParams.get('q') ?? '';
  expect(prompt).toContain(`Chýba termín ${stamp}`);
  expect(prompt).toContain('Pozri program Šport.');
  expect(prompt).toContain(host);
  expect(prompt).toContain('admin_instance_call_write');
});
