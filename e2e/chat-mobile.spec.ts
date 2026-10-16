import { expect, test } from '@playwright/test';

// On a phone the message actions are a "⋯" button and a bottom sheet, not the hover toolbar.
test('on a phone, "⋯" opens the action sheet and Reply in thread opens the thread', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'sk-SK',
    storageState: 'e2e/.auth/superadmin.json',
  });
  // The install card (AppPrompt) sits over the composer on a phone; this test is about the
  // action sheet, so the card counts as dismissed just now.
  await context.addInitScript(() => {
    localStorage.setItem('spolu.prompt.install.dismissedAt', String(Date.now()));
  });
  const page = await context.newPage();
  try {
    const stamp = Date.now();
    const created = await page.request.post('/api/groups', {
      data: { name: `E2E Mobil chat ${stamp}`, egrantUrl: `https://e2e-mchat-${stamp}.egrant.sk` },
    });
    const group = (await created.json()) as { id: string };
    await page.goto(`/groups/${group.id}/chat`);
    const box = page.getByRole('textbox', { name: 'Napíšte správu…' });
    await box.fill('Dobrý deň');
    await page.getByRole('button', { name: 'Odoslať' }).tap();
    const message = page.locator('[data-message-id]').filter({ hasText: 'Dobrý deň' });
    await expect(message).toBeVisible();

    // No floating toolbar on touch; "⋯" sits on the name line.
    await expect(message.getByRole('toolbar', { name: 'Akcie správy' })).toBeHidden();
    await message.getByRole('button', { name: 'Akcie správy' }).tap();
    const sheet = page.getByRole('dialog', { name: 'Akcie správy' });
    await expect(sheet.getByRole('button')).toHaveText([
      'Odpovedať vo vlákne',
      'Upraviť',
      'Odstrániť',
    ]);
    const row = (await sheet.getByRole('button').first().boundingBox())!;
    expect(row.height).toBe(48);
    await sheet.getByRole('button', { name: 'Odpovedať vo vlákne' }).tap();
    await expect(sheet).toHaveCount(0);

    const thread = page.getByRole('region', { name: 'Vlákno' });
    await thread.getByRole('textbox', { name: 'Odpovedať…' }).fill('Odpoveď z mobilu');
    await thread.getByRole('button', { name: 'Odoslať' }).tap();
    await expect(thread.getByText('Odpoveď z mobilu')).toBeVisible();
  } finally {
    await context.close();
  }
});
