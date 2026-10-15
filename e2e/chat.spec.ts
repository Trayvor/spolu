import { expect, test, type Locator, type Page } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

async function createGroup(page: Page, name: string, egrantUrl: string) {
  await page.goto('/groups');
  await page.getByRole('button', { name: 'Vytvoriť skupinu' }).first().click();
  await page.getByLabel('Názov').fill(name);
  await page.getByLabel('Adresa klienta v eGrant').fill(egrantUrl);
  await page.getByRole('button', { name: 'Uložiť' }).click();
  await expect(page.getByRole('button', { name: 'Uložiť' })).toHaveCount(0);
}

/** The group's tab bar. */
function tabs(page: Page): Locator {
  return page.getByRole('navigation', { name: 'Časti skupiny' });
}

/** A message row, found by its text. */
function row(page: Page, text: string): Locator {
  return page.locator('[data-message-id]').filter({ hasText: text });
}

async function send(page: Page, placeholder: string, text: string) {
  const box = page.getByRole('textbox', { name: placeholder });
  await box.fill(text);
  await box.press('Enter');
}

/** Open the "more" menu of a row (the toolbar shows on hover) and pick an entry. */
async function rowAction(message: Locator, entry: 'Upraviť' | 'Odstrániť') {
  await message.hover();
  await message.getByRole('button', { name: 'Viac' }).click();
  await message.page().getByRole('menuitem', { name: entry }).click();
}

// One serial flow: production rate limits allow only a few code requests per minute, so a
// single client logs in once.
test('admin and client chat in real time, in threads, with mentions and files, across a drop', async ({
  page: admin,
  browser,
}) => {
  const stamp = Date.now();
  const name = `E2E Chat ${stamp}`;
  const email = `e2e-chat-${stamp}@example.com`;

  await createGroup(admin, name, `https://e2e-chat-${stamp}.egrant.sk`);
  await admin.getByRole('link', { name: new RegExp(name) }).click();
  await expect(admin).toHaveURL(/\/groups\/[^/]+\/chat$/);
  const groupPath = new URL(admin.url()).pathname.replace(/\/chat$/, '');
  await admin.goto(`${groupPath}/members`);
  const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();

  // The client joins by invite in a second context. Its WebSocket goes through a route we can
  // cut: Chromium's offline emulation alone does not close an established socket.
  const clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  let offline = false;
  const sockets = new Set<{ close(): void }>();
  await clientContext.routeWebSocket(/\/socket\.io\//, (ws) => {
    if (offline) {
      void ws.close();
      return;
    }
    ws.connectToServer();
    sockets.add(ws);
  });
  const client = await clientContext.newPage();
  await client.goto(new URL(inviteUrl).pathname);
  await clearMailFor(clientContext.request, email);
  await client.getByLabel('E-mail').fill(email);
  await client.getByRole('button', { name: 'Poslať kód' }).click();
  await client.getByLabel('Kód').fill(await latestLoginCode(clientContext.request, email));
  await client.getByLabel('Vaše meno').fill('E2E Client');
  await client.getByRole('button', { name: 'Pokračovať' }).click();
  await expect(client).toHaveURL(new RegExp(`${groupPath}/chat$`));

  // The admin opens the chat and writes; the client is on another tab, so its Chat tab badge
  // shows the unread message.
  await admin.goto(`${groupPath}/chat`);
  await client.getByRole('link', { name: 'Členovia' }).click();
  await expect(client).toHaveURL(/\/members$/);
  await send(admin, 'Napíšte správu…', 'Ahoj');
  await expect(row(admin, 'Ahoj')).toBeVisible();
  await expect(
    tabs(client).getByRole('link', { name: /^Chat/ }).getByText('1', { exact: true }),
  ).toBeVisible();
  await tabs(client).getByRole('link', { name: /^Chat/ }).click();
  await expect(row(client, 'Ahoj')).toBeVisible();
  await expect(client.getByText('Neprečítaná správa: 1')).toHaveCount(0);

  // A real browser: the mention picker opened while editing the message at the very top must
  // not be clipped by the list.
  await rowAction(row(admin, 'Ahoj'), 'Upraviť');
  const editBox = admin.getByRole('textbox', { name: 'Upraviť' });
  await editBox.fill('Ahoj @Client');
  const picker = admin.getByRole('listbox', { name: 'Ľudia' });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option', { name: /E2E Client/ })).toBeVisible();
  const unclipped = await picker.evaluate((list) => {
    const box = list.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + 4);
    return box.top >= 0 && !!hit && list.contains(hit);
  });
  expect(unclipped).toBe(true);
  await editBox.press('Escape');
  await admin.getByRole('button', { name: 'Zrušiť' }).click();
  await expect(row(admin, 'Ahoj')).toBeVisible();

  // Thread: the client replies, the admin sees the count and the reply in the panel.
  await row(client, 'Ahoj').hover();
  await row(client, 'Ahoj').getByRole('button', { name: 'Odpovedať vo vlákne' }).click();
  await send(client, 'Odpovedať…', 'Prvá odpoveď');
  await expect(
    client.getByRole('region', { name: 'Vlákno' }).getByText('Prvá odpoveď'),
  ).toBeVisible();
  await expect(admin.getByRole('button', { name: /1 odpoveď/ })).toBeVisible();
  await admin.getByRole('button', { name: /1 odpoveď/ }).click();
  await expect(
    admin.getByRole('region', { name: 'Vlákno' }).getByText('Prvá odpoveď'),
  ).toBeVisible();
  await admin.getByRole('button', { name: 'Zavrieť vlákno' }).click();
  await client.getByRole('button', { name: 'Zavrieť vlákno' }).click();

  // Mention through the picker: "@Client", Enter picks the client, the client sees a marked row.
  const box = admin.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill('Pozor @Client');
  await expect(admin.getByRole('option', { name: /E2E Client/ })).toBeVisible();
  await box.press('Enter');
  await box.pressSequentially('hotovo');
  await box.press('Enter');
  const mentioned = row(client, 'hotovo');
  await expect(mentioned).toBeVisible();
  await expect(mentioned).toHaveClass(/border-brand-purple/);

  // Attachment: the admin sees the image preview loaded.
  await client.locator('input[type="file"]').setInputFiles('e2e/fixtures/logo.png');
  await client.getByRole('textbox', { name: 'Napíšte správu…' }).fill('Logo');
  // The send button enables once the upload has finished.
  await expect(client.getByRole('button', { name: 'Odoslať' })).toBeEnabled();
  await client.getByRole('button', { name: 'Odoslať' }).click();
  const logo = row(admin, 'Logo').locator('img');
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  // Edit and delete by the client show on the admin side.
  await send(client, 'Napíšte správu…', 'Pôvodný text');
  await rowAction(row(client, 'Pôvodný text'), 'Upraviť');
  const clientEdit = client.getByRole('textbox', { name: 'Upraviť' });
  await clientEdit.fill('Nový text');
  await clientEdit.press('Enter');
  await expect(row(admin, 'Nový text')).toContainText('(upravené)');
  await send(client, 'Napíšte správu…', 'Na zmazanie');
  await rowAction(row(client, 'Na zmazanie'), 'Odstrániť');
  await row(client, 'Na zmazanie').getByRole('button', { name: 'Odstrániť' }).click();
  await expect(admin.getByText('Správa bola odstránená')).toHaveCount(1);

  // The admin's own messages for the offline step.
  await send(admin, 'Napíšte správu…', 'Zmaž ma');
  await expect(row(client, 'Zmaž ma')).toBeVisible();

  // Offline: cut the socket and the network. The client misses a message, an edit and a delete.
  offline = true;
  await clientContext.setOffline(true);
  for (const ws of sockets) ws.close();
  sockets.clear();
  await send(admin, 'Napíšte správu…', 'Počas výpadku');
  await expect(row(admin, 'Počas výpadku')).toBeVisible();
  await rowAction(row(admin, 'Ahoj'), 'Upraviť');
  const adminEdit = admin.getByRole('textbox', { name: 'Upraviť' });
  await adminEdit.fill('Ahoj zmenené');
  await adminEdit.press('Enter');
  await expect(row(admin, 'Ahoj zmenené')).toBeVisible();
  await rowAction(row(admin, 'Zmaž ma'), 'Odstrániť');
  await row(admin, 'Zmaž ma').getByRole('button', { name: 'Odstrániť' }).click();
  await expect(admin.getByText('Správa bola odstránená')).toHaveCount(2);

  await expect(row(client, 'Počas výpadku')).toHaveCount(0, { timeout: 2000 });
  await expect(row(client, 'Ahoj zmenené')).toHaveCount(0, { timeout: 2000 });
  await expect(row(client, 'Zmaž ma')).toBeVisible();

  // Back online: catch-up brings all three without a reload.
  offline = false;
  await clientContext.setOffline(false);
  await expect(row(client, 'Počas výpadku')).toBeVisible({ timeout: 20_000 });
  await expect(row(client, 'Ahoj zmenené')).toBeVisible();
  await expect(row(client, 'Zmaž ma')).toHaveCount(0);
  await expect(client.getByText('Správa bola odstránená')).toHaveCount(2);

  await clientContext.close();
});
