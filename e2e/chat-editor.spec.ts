import { expect, test, type Page } from '@playwright/test';

const row = (page: Page, text: string) =>
  page.locator('[data-message-id]').filter({ hasText: text });

/** A paste of plain text, as from a text editor (Chromium builds the event with its data). */
async function pasteText(page: Page, name: string, text: string) {
  await page.getByRole('textbox', { name }).evaluate((el, value) => {
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, text);
}

// Phase 28: the composer shows formatting while typing and still sends Markdown, which every
// chat renders as before; an edit opens the message formatted and saves it unchanged.
test('the chat editor formats Markdown while typing, on paste and when editing', async ({
  page,
}) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Editor ${stamp}`, egrantUrl: `https://e2e-editor-${stamp}.egrant.sk` },
  });
  const group = (await created.json()) as { id: string };
  await page.goto(`/groups/${group.id}/chat`);

  const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
  await box.click();
  // Typed Markdown turns into formatting at once; Shift+Enter continues the list.
  await box.pressSequentially('Plán **dnes** a _zajtra_');
  await expect(box.locator('strong')).toHaveText('dnes');
  await expect(box.locator('em')).toHaveText('zajtra');
  await box.press('Shift+Enter');
  await box.pressSequentially('- prvý');
  await box.press('Shift+Enter');
  await box.pressSequentially('druhý');
  await expect(box.locator('li')).toHaveCount(2);
  await box.press('Enter');

  const sent = row(page, 'Plán dnes a zajtra');
  await expect(sent.locator('strong')).toHaveText('dnes');
  await expect(sent.locator('em')).toHaveText('zajtra');
  await expect(sent.locator('ul li')).toHaveText(['prvý', 'druhý']);
  await expect(box).toHaveText('');

  // Pasted Markdown renders in the field and in the message.
  await box.click();
  await pasteText(page, 'Napíšte správu…', '## Zhrnutie\n> citát\n`kód`');
  await expect(box.locator('h4')).toHaveText('Zhrnutie');
  await expect(box.locator('blockquote')).toHaveText('citát');
  await box.press('Enter');
  const summary = row(page, 'Zhrnutie');
  await expect(summary.locator('h4')).toHaveText('Zhrnutie');
  await expect(summary.locator('blockquote')).toHaveText('citát');
  await expect(summary.locator('code')).toHaveText('kód');

  // Editing shows the formatting and an unchanged save keeps the message as it was.
  await sent.hover();
  await sent.getByRole('button', { name: 'Viac' }).click();
  await page.getByRole('menuitem', { name: 'Upraviť' }).click();
  const edit = page.getByRole('textbox', { name: 'Upraviť' });
  await expect(edit.locator('strong')).toHaveText('dnes');
  await expect(edit.locator('li')).toHaveCount(2);
  await edit.press('End');
  await edit.pressSequentially(' ~~nie~~');
  await edit.press('Enter');
  await expect(sent).toContainText('(upravené)');
  await expect(sent.locator('s')).toHaveText('nie');
  await expect(sent.locator('ul li')).toHaveText(['prvý', 'druhý nie']);
});
