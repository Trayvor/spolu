import { expect, test, type Locator } from '@playwright/test';

/** Two quick taps in the page itself (Playwright's own `tap()` calls can be over 300 ms apart). */
async function doubleTap(target: Locator) {
  await target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const touch = new Touch({
      identifier: 1,
      target: el,
      clientX: r.x + 8,
      clientY: r.y + r.height / 2,
    });
    const fire = (type: string, touches: Touch[]) =>
      el.dispatchEvent(
        new TouchEvent(type, { bubbles: true, cancelable: true, touches, changedTouches: [touch] }),
      );
    for (let i = 0; i < 2; i++) {
      fire('touchstart', [touch]);
      fire('touchend', []);
    }
  });
}

// On a phone a long press or a double tap on a message opens its action sheet: no hover toolbar
// and no visible "⋯" button (a visually hidden one stays for screen readers and keyboards).
test('on a phone, a long press opens the action sheet and Reply in thread opens the thread', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    reducedMotion: 'reduce', // measured boxes: no sheet animation in flight
    hasTouch: true,
    locale: 'sk-SK',
    storageState: 'e2e/.auth/superadmin.json',
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

    // No floating toolbar and no visible "⋯" on touch.
    await expect(message.getByRole('toolbar', { name: 'Akcie správy' })).toBeHidden();
    const opener = message.getByRole('button', { name: 'Akcie správy' });
    expect(await opener.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);

    // A double tap on the text opens the sheet; it closes on Escape.
    const text = message.getByText('Dobrý deň');
    await doubleTap(text);
    const sheet = page.getByRole('dialog', { name: 'Akcie správy' });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);

    // A long press (450 ms held without moving) opens it too.
    const at = (await text.boundingBox())!;
    const touch = { identifier: 1, clientX: at.x + 8, clientY: at.y + at.height / 2 };
    await text.dispatchEvent('touchstart', { touches: [touch], changedTouches: [touch] });
    await expect(sheet).toBeVisible();
    await text.dispatchEvent('touchend', { touches: [], changedTouches: [touch] });
    // The quick reactions row sits on top (Phase 28); the actions follow it.
    await expect(sheet.getByRole('group', { name: 'Rýchle reakcie' })).toBeVisible();
    const actions = sheet.locator('button:not([role="group"] button)');
    // "Vytvoriť úlohy" (Turn into tasks): the e2e server runs the fake AI provider.
    await expect(actions).toHaveText([
      'Odpovedať vo vlákne',
      'Kopírovať text',
      'Vytvoriť úlohy',
      'Upraviť',
      'Odstrániť',
    ]);
    const row = (await actions.first().boundingBox())!;
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
