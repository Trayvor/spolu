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

// Phase 21, part 21.5: the admin turns a ticket into two tasks (the fake AI makes one per list
// line); both link back to the ticket and the ticket lists them.
test('an admin turns a ticket into tasks that link back to it', async ({ page }) => {
  const stamp = Date.now();
  const host = `e2e-ticket-tasks-${stamp}.egrant.sk`;
  await createGroup(page, `E2E Tiket na úlohy ${stamp}`, `https://${host}`);
  const res = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: {
      subject: `Rozpočet ${stamp}`,
      body: '- Opraviť krok rozpočtu\n- Odpísať žiadateľovi',
      due_date: '2030-01-15',
      instance_url: `https://${host}`,
    },
  });
  expect(res.status()).toBe(201);
  const { id, number } = (await res.json()) as { id: string; number: number };

  await page.goto(`/tickets/${id}`);
  await page.getByRole('button', { name: 'Vytvoriť úlohy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vytvoriť úlohy' });
  await expect(dialog.getByText(`#${number} Rozpočet ${stamp}`)).toBeVisible();
  await expect(dialog.getByRole('article')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Schváliť všetky' }).click();
  await dialog.getByRole('button', { name: 'Vytvoriť 2 úlohy' }).click();
  await expect(dialog).toHaveCount(0);

  const tasks = page.getByRole('region', { name: /^Úlohy/ });
  // The section also links to the board; only the list holds the tasks.
  await expect(tasks.getByRole('list').getByRole('link')).toHaveText([
    'Opraviť krok rozpočtu',
    'Odpísať žiadateľovi',
  ]);
  for (const title of ['Opraviť krok rozpočtu', 'Odpísať žiadateľovi']) {
    await page.goto(`/tickets/${id}`);
    await page
      .getByRole('region', { name: /^Úlohy/ })
      .getByRole('link', { name: title })
      .click();
    const panel = page.getByRole('complementary', { name: 'Úloha' });
    await expect(panel.getByRole('link', { name: `#${number} Rozpočet ${stamp}` })).toBeVisible();
  }
});

// Owner request 2026-10-17: riešitelia and "Watch tickets".
test('an admin picks a riešiteľ, filters by it and watches the client tickets', async ({
  page,
}) => {
  const stamp = Date.now();
  const host = `e2e-ticket-assignee-${stamp}.egrant.sk`;
  const groupPath = await createGroup(page, `E2E Riešiteľ ${stamp}`, `https://${host}`);
  const res = await page.request.post('/api/tickets/intake', {
    headers: { authorization: `Bearer ${KEY}` },
    data: { subject: `Riešiteľ ${stamp}`, instance_url: `https://${host}` },
  });
  expect(res.status()).toBe(201);
  const { id } = (await res.json()) as { id: string };
  const me = (await (await page.request.get('/api/me')).json()) as { name: string };

  // The picker offers every admin; the pick saves at once. There is no Follow button any more.
  await page.goto(`/tickets/${id}`);
  const picker = page.getByRole('combobox', { name: 'Riešitelia (0)' });
  await picker.click();
  await picker.fill(me.name);
  await page
    .getByRole('option', { name: new RegExp(me.name) })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Riešitelia (1)' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Sledovať$|^Sledujete$/ })).toHaveCount(0);

  // The group list shows the riešiteľ; the riešiteľ filter narrows the list.
  await page.goto(`${groupPath}/tickets`);
  // By href: the group header's instance link also carries the stamp.
  const row = page.locator(`a[href="/tickets/${id}"]`);
  await expect(row).toContainText(`Riešitelia: ${me.name}`);
  await page.getByRole('button', { name: 'Riešiteľ: Ktokoľvek' }).click();
  await page.getByRole('menuitemradio', { name: 'Nikto' }).click();
  await expect(page).toHaveURL(/assignee=none/);
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: 'Riešiteľ: Nikto' }).click();
  await page.getByRole('menuitemradio', { name: 'Ja' }).click();
  await expect(row).toBeVisible();

  // "Watch tickets": off for an admin who does not manage the client; ticking it is kept.
  const watch = page.getByRole('checkbox', { name: 'Sledovať tikety' });
  await expect(watch).not.toBeChecked();
  await watch.check();
  await expect(
    page.getByText(
      'Dostanete upozornenie na každý nový tiket tohto klienta a na jeho novinky, kým nemá riešiteľa.',
    ),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('checkbox', { name: 'Sledovať tikety' })).toBeChecked();
});
