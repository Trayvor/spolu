import { expect, test, type Page } from '@playwright/test';
import { logInWithCode } from './login';

const KEY = 'e2e-tickets-key-0123456789';

async function createGroup(page: Page, name: string, egrantUrl: string): Promise<string> {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Vytvoriť skupinu' }).first().click();
  await page.getByLabel('Názov').fill(name);
  await page.getByLabel('Adresa klienta v eGrant').fill(egrantUrl);
  await page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(page.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
  await page.locator('a[href^="/groups/"]:not([href$="/chat"])', { hasText: name }).click();
  await expect(page).toHaveURL(/\/groups\/[^/]+\/chat$/);
  return new URL(page.url()).pathname.replace(/\/chat$/, '');
}

// Phase 21, part 21.4: the ticket screens for a requester and an admin.
test('a requester sees only their ticket and writes in its chat; the admin answers', async ({
  page,
  browser,
}) => {
  const stamp = Date.now();
  const name = `E2E Tikety ${stamp}`;
  const host = `e2e-tickets-${stamp}.egrant.sk`;
  const email = `e2e-requester-${stamp}@example.com`;
  const groupPath = await createGroup(page, name, `https://${host}`);

  // eGrant sends the ticket; the instance link finds the client.
  const res = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: {
      subject: `Nejde odoslať ${stamp}`,
      body: 'Formulár hlási chybu.',
      area: 'Prihlásenie',
      email,
      requester_name: 'E2E Žiadateľ',
      instance_url: `https://www.${host}/app`,
    },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };

  // The requester logs in and lands on My tickets: only Tickets in the header.
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const requester = await context.newPage();
  await logInWithCode(requester, context.request, email);
  await expect(requester).toHaveURL(/\/tickets$/);
  await expect(requester.getByRole('heading', { name: 'Moje tikety' })).toBeVisible();
  await requester.getByRole('link', { name: new RegExp(`Nejde odoslať ${stamp}`) }).click();
  await expect(requester).toHaveURL(new RegExp(`/tickets/${id}$`));
  const box = requester.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill('Prikladám popis chyby.');
  await box.press('Enter');
  await expect(
    requester.locator('[data-message-id]').filter({ hasText: 'Prikladám popis chyby.' }),
  ).toBeVisible();
  // The group itself stays closed to them.
  await requester.goto(`${groupPath}/chat`);
  await expect(requester.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();

  // The admin finds it in the group's Tickets tab, sets In progress and replies.
  await page.goto(`${groupPath}/tickets`);
  await page.getByRole('link', { name: new RegExp(`Nejde odoslať ${stamp}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/tickets/${id}$`));
  await page.getByRole('combobox', { name: 'Stav' }).selectOption('in_progress');
  await expect(
    page.locator('[data-message-id]').filter({ hasText: 'Prikladám popis chyby.' }),
  ).toBeVisible();
  const adminBox = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await adminBox.fill('Pozrieme sa na to.');
  await adminBox.press('Enter');

  // The requester sees the reply and the new status live.
  await requester.goto(`/tickets/${id}`);
  await expect(
    requester.locator('[data-message-id]').filter({ hasText: 'Pozrieme sa na to.' }),
  ).toBeVisible();
  await expect(requester.getByText('V riešení').first()).toBeVisible();
  await context.close();
});

test('an admin creates a ticket for a client from the group tab', async ({ page }) => {
  const stamp = Date.now();
  const groupPath = await createGroup(
    page,
    `E2E Nový tiket ${stamp}`,
    `https://e2e-new-ticket-${stamp}.egrant.sk`,
  );
  await page.goto(`${groupPath}/tickets`);
  await page.getByRole('button', { name: 'Nový tiket' }).click();
  await page.getByLabel('E-mail iniciátora').fill(`e2e-initiator-${stamp}@example.com`);
  await page.getByLabel('Meno iniciátora').fill('E2E Iniciátor');
  await page.getByLabel('Predmet').fill(`Ručný tiket ${stamp}`);
  await page.getByRole('button', { name: 'Vytvoriť tiket' }).click();
  await expect(page).toHaveURL(/\/tickets\/[^/]+$/);
  await expect(page.getByRole('heading', { name: `Ručný tiket ${stamp}` })).toBeVisible();
  await expect(page.getByTestId('ticket-chat')).toBeVisible();

  await page.goto(`${groupPath}/members`);
  await expect(page.getByRole('heading', { name: 'Žiadatelia' })).toBeVisible();
  await expect(page.getByText('E2E Iniciátor')).toBeVisible();
});
