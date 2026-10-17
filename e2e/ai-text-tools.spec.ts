import { expect, test, type Page } from '@playwright/test';

// Phase 28: the composer's AI text tools and voice input, on the fake providers
// (AI_PROVIDER=fake and TRANSCRIPTION_PROVIDER=fake in playwright.config.ts) and Chromium's fake
// microphone. Nothing is sent: the result lands in the draft.

test.use({
  permissions: ['microphone'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

async function groupChat(page: Page, tld: string) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E AI text ${stamp}`, egrantUrl: `https://e2e-ait-${stamp}.egrant.${tld}` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  await page.goto(`/groups/${group.id}/chat`);
  return page.getByRole('textbox', { name: 'Napíšte správu…' });
}

test('Fix mistakes and Make it formal replace the draft, with Undo, and send nothing', async ({
  page,
}) => {
  const box = await groupChat(page, 'sk');
  await box.fill('ahoj ako sa mas');
  await page.getByRole('button', { name: 'AI nástroje' }).click();
  // A .sk instance: no translation.
  await expect(page.getByRole('menuitem', { name: /Preložiť/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Opraviť chyby' }).click();
  await expect(box).toHaveText('Ahoj ako sa mas.');
  // Undo sits in the composer's row, next to the AI button (the field is the chat editor, so
  // its text is checked with toHaveText).
  await box
    .locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]')
    .getByRole('button', { name: 'Späť', exact: true })
    .click();
  await expect(box).toHaveText('ahoj ako sa mas');

  await box.fill('task one: call the bank, task two: send the report');
  await page.getByRole('button', { name: 'AI nástroje' }).click();
  await page.getByRole('menuitem', { name: 'Formálnejšie' }).click();
  // The answer is Markdown: the editor shows it as a numbered list.
  await expect(box.locator('ol li')).toHaveText(['Call the bank', 'Send the report']);
  // Nothing was sent.
  await expect(page.locator('[data-message-id]')).toHaveCount(0);
});

test('Translate is offered off .sk, to English and to the client language', async ({ page }) => {
  const box = await groupChat(page, 'cz');
  await box.fill('dobrý den');
  await page.getByRole('button', { name: 'AI nástroje' }).click();
  await expect(page.getByRole('menuitem', { name: 'Preložiť: angličtina' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Preložiť: čeština' }).click();
  await expect(box).toHaveText('[Czech] dobrý den');
});

test('voice input records until Stop and puts the transcript in the draft', async ({ page }) => {
  const box = await groupChat(page, 'sk');
  await box.fill('Poznámka:');
  await page.getByRole('button', { name: 'Diktovať' }).click();
  await expect(page.getByRole('timer')).toContainText('/ 5:00');
  await page.getByRole('button', { name: 'Zastaviť a prepísať' }).click();
  await expect(box).toHaveText(/^Poznámka: Anna: Dobrý deň, poďme na rozpočet projektu\./);
  await expect(page.locator('[data-message-id]')).toHaveCount(0);

  // Cancel throws the recording away.
  await page.getByRole('button', { name: 'Diktovať' }).click();
  await page.getByRole('button', { name: 'Zrušiť nahrávanie' }).click();
  await expect(page.getByRole('button', { name: 'Diktovať' })).toBeVisible();
  await expect(box).toHaveText(/^Poznámka: Anna:/);
});
