import { expect, test, type Locator, type Page } from '@playwright/test';

/** A message row, found by its text. */
function row(page: Page, text: string): Locator {
  return page.locator('[data-message-id]').filter({ hasText: text });
}

async function send(page: Page, placeholder: string, text: string) {
  const box = page.getByRole('textbox', { name: placeholder });
  await box.fill(text);
  await box.press('Enter');
}

// The fake AI (AI_PROVIDER=fake, set in playwright.config.ts) turns each "- " line into one card.
test('a message with 5 jobs becomes 4 reviewed tasks with links both ways and working task chats', async ({
  page,
}) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E AI ${stamp}`, egrantUrl: `https://e2e-ai-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };

  // Send the message in the group chat.
  const text = [
    '- Write the report',
    '- Call the bank',
    '- Fix the logo',
    '- Book the room',
    '- Send the invoice',
  ].join('\n');
  await page.goto(`/groups/${group.id}/chat`);
  await send(page, 'Napíšte správu…', text);
  const message = row(page, 'Write the report');
  await expect(message).toBeVisible();

  // Hover → More → "Vytvoriť úlohy": five cards to review.
  await message.hover();
  await message.getByRole('button', { name: 'Viac' }).click();
  await page.getByRole('menuitem', { name: 'Vytvoriť úlohy' }).click();
  const dialog = page.getByRole('dialog', { name: 'Vytvoriť úlohy' });
  await expect(dialog.getByRole('article')).toHaveCount(5);

  // Reject one, rename another, approve the rest.
  await dialog
    .getByRole('article', { name: 'Fix the logo' })
    .getByRole('button', { name: 'Zamietnuť' })
    .click();
  await dialog.getByRole('button', { name: 'Upraviť „Call the bank“' }).click();
  const editing = dialog.getByRole('article', { name: 'Call the bank' });
  await editing.getByLabel('Názov', { exact: true }).fill('Call the bank today');
  await dialog.getByRole('button', { name: 'Hotovo' }).click();
  for (const title of [
    'Write the report',
    'Call the bank today',
    'Book the room',
    'Send the invoice',
  ]) {
    await dialog
      .getByRole('article', { name: title })
      .getByRole('button', { name: 'Schváliť', exact: true })
      .click();
  }
  await dialog.getByRole('button', { name: 'Vytvoriť 4 úlohy' }).click();
  await expect(page.getByText('4 úlohy vytvorené')).toBeVisible();
  await expect(dialog).toHaveCount(0);

  // The message footer links to the four tasks.
  const footer = message.getByText('Premenené na úlohy:').locator('..');
  await expect(footer.getByRole('link')).toHaveCount(4);
  await footer.getByRole('link', { name: 'Call the bank today' }).click();
  const panel = page.getByRole('complementary', { name: 'Úloha' });
  await expect(panel.getByLabel('Názov', { exact: true })).toHaveValue('Call the bank today');

  // The task links back to the message.
  await panel.getByRole('link', { name: 'Otvoriť v chate' }).click();
  await expect(page).toHaveURL(/\/chat/);
  await expect(row(page, 'Write the report')).toBeVisible();

  // The board's To do column starts with the four titles in order.
  await page.goto(`/groups/${group.id}/tasks`);
  const todo = page.getByRole('region', { name: 'Na spracovanie' });
  await expect(todo.getByRole('link').filter({ hasNotText: 'Pridať úlohu' })).toHaveText([
    /Write the report/,
    /Call the bank today/,
    /Book the room/,
    /Send the invoice/,
  ]);

  // A task's own chat: a message, then a reply in its thread.
  await todo.getByRole('link', { name: /Call the bank today/ }).click();
  const taskPanel = page.getByRole('complementary', { name: 'Úloha' });
  await taskPanel.getByRole('tab', { name: /^Chat/ }).click();
  await send(page, 'Napíšte správu…', 'Bank opens at nine');
  const taskMessage = row(page, 'Bank opens at nine');
  await expect(taskMessage).toBeVisible();
  // From the keyboard: the hover bar sits above the row, over the day divider, and is clipped
  // whenever the pointer is not on the row (content-visibility), which a retried click can hit.
  await taskMessage.getByRole('button', { name: 'Odpovedať vo vlákne' }).focus();
  await page.keyboard.press('Enter');
  await send(page, 'Odpovedať…', 'Thanks, noted');
  await expect(
    page.getByRole('region', { name: 'Vlákno' }).getByText('Thanks, noted'),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Späť na chat' }).click();
  await expect(row(page, 'Bank opens at nine').getByText(/1 odpoveď/)).toBeVisible();

  // A mention and a file in the task chat.
  const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.fill('Heads up @all');
  await expect(page.getByRole('option', { name: /Všetci pri tomto klientovi/ })).toBeVisible();
  await box.press('Enter');
  await box.pressSequentially('see the logo');
  await taskPanel
    .getByRole('tabpanel')
    .locator('input[type="file"]')
    .setInputFiles('e2e/fixtures/logo.png');
  await expect(page.getByRole('button', { name: 'Odoslať' })).toBeEnabled();
  await page.getByRole('button', { name: 'Odoslať' }).click();
  const withFile = row(page, 'see the logo');
  await expect(withFile).toContainText('@all');
  await expect(withFile.locator('img')).toBeVisible();

  // Another task's chat is its own: it starts empty.
  await page.goto(`/groups/${group.id}/tasks`);
  await page
    .getByRole('region', { name: 'Na spracovanie' })
    .getByRole('link', { name: /Book the room/ })
    .click();
  await page
    .getByRole('complementary', { name: 'Úloha' })
    .getByRole('tab', { name: /^Chat/ })
    .click();
  await expect(page.getByRole('textbox', { name: 'Napíšte správu…' })).toBeVisible();
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
});
