import { expect, test } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

// One serial flow in two browsers: production rate limits allow only a few code requests per minute,
// so the client logs in once, through the API. The admin uses the shared stored superadmin session.
test('admin and client work on the same task board live', async ({ page: admin, browser }) => {
  const stamp = Date.now();
  const email = `e2e-tasks-${stamp}@example.com`;
  const card = (title: string) => (p: typeof admin) => p.getByRole('link', { name: title });
  const bucket = (p: typeof admin, name: string) => p.getByRole('region', { name });

  // Setup through the API: a group, its invite link, a client who joined and logged in.
  const created = await admin.request.post('/api/groups', {
    data: { name: `E2E Tasks ${stamp}`, egrantUrl: `https://e2e-tasks-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  const token = new URL(group.inviteUrl).pathname.split('/').pop();

  const clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const request = clientContext.request;
  try {
    await clearMailFor(request, email);
    expect((await request.post(`/api/join/${token}`, { data: { email } })).ok()).toBe(true);
    expect(
      (
        await request.post('/api/auth/email-otp/send-verification-otp', {
          data: { email, type: 'sign-in' },
        })
      ).ok(),
    ).toBe(true);
    const otp = await latestLoginCode(request, email);
    expect((await request.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(
      true,
    );
    expect((await request.patch('/api/me', { data: { name: 'E2E Klient' } })).ok()).toBe(true);

    const client = await clientContext.newPage();
    const url = `/groups/${group.id}/tasks`;
    await Promise.all([admin.goto(url), client.goto(url)]);
    await expect(bucket(admin, 'Na spracovanie')).toBeVisible();
    await expect(bucket(client, 'Na spracovanie')).toBeVisible();

    // The client adds a card; the admin sees it without reloading.
    await client.getByRole('link', { name: 'Pridať úlohu' }).first().click();
    const newPanel = client.getByRole('complementary', { name: 'Úloha' });
    await newPanel.getByLabel('Názov', { exact: true }).fill('Rozpočet');
    // The first Create with an empty link only warns and focuses the link; the second creates.
    await newPanel.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(newPanel.getByText(/Odkaz je prázdny/)).toBeVisible();
    await expect(newPanel.getByRole('textbox', { name: 'Odkaz', exact: true })).toBeFocused();
    await newPanel.getByRole('button', { name: 'Vytvoriť' }).click();
    await expect(newPanel).toHaveCount(0);
    await expect(bucket(client, 'Na spracovanie').getByText('Rozpočet')).toBeVisible();
    await expect(bucket(admin, 'Na spracovanie').getByText('Rozpočet')).toBeVisible();

    // The admin moves it with the keyboard: Space lifts, ArrowRight crosses a column, Space drops.
    await card('Rozpočet')(admin).focus();
    await admin.keyboard.press('Space');
    // dnd-kit starts listening for the arrow keys in a timer queued before the announcement;
    // a page-side 0 ms timer queued now fires after it.
    await expect(admin.getByText('Úloha Rozpočet je nad stĺpcom Na spracovanie.')).toBeAttached();
    await admin.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    await admin.keyboard.press('ArrowRight');
    await expect(admin.getByText('Úloha Rozpočet je nad stĺpcom Kontrola eGrant.')).toBeAttached();
    await admin.keyboard.press('Space');
    await expect(bucket(admin, 'Kontrola eGrant').getByText('Rozpočet')).toBeVisible();
    await expect(bucket(client, 'Kontrola eGrant').getByText('Rozpočet')).toBeVisible();

    // The client opens the card, marks it urgent, attaches a file and saves.
    await card('Rozpočet')(client).click();
    const panel = client.getByRole('complementary', { name: 'Úloha' });
    await expect(panel).toBeVisible();
    await panel.getByRole('switch', { name: 'Urgentné' }).click();
    await panel.getByTestId('task-file-input').setInputFiles('e2e/fixtures/logo.png');
    await expect(panel.getByRole('link', { name: /logo\.png/ })).toBeVisible();
    await panel.getByRole('button', { name: 'Uložiť zmeny' }).click();
    await expect(panel.getByRole('button', { name: 'Uložiť zmeny' })).toHaveCount(0);
    await panel.getByRole('button', { name: 'Zavrieť' }).click();

    // The admin sees the Urgent pill and the paperclip on the card.
    const adminCard = card('Rozpočet')(admin);
    await expect(adminCard.getByText('Urgentné')).toBeVisible();
    await expect(adminCard.getByText('1 súbor')).toBeAttached();

    // The admin opens the task; the attached file answers 200.
    await adminCard.click();
    const adminPanel = admin.getByRole('complementary', { name: 'Úloha' });
    const href = await adminPanel
      .locator('a[href^="/api/files/"]:not([href$="/preview"])')
      .first()
      .getAttribute('href');
    expect(href).toBeTruthy();
    expect((await admin.request.get(href!)).status()).toBe(200);
    await adminPanel.getByRole('button', { name: 'Zavrieť' }).click();
    await expect(adminPanel).toHaveCount(0);

    // The admin adds a custom column; the client sees it, then the admin deletes it (confirm).
    await admin.getByRole('button', { name: 'Pridať stĺpec' }).click();
    await admin.getByLabel('Názov stĺpca').fill('Moje');
    await admin.getByLabel('Názov stĺpca').press('Enter');
    await expect(bucket(admin, 'Moje')).toBeVisible();
    await expect(bucket(client, 'Moje')).toBeVisible();
    await bucket(admin, 'Moje').getByRole('button', { name: 'Viac' }).click();
    await admin.getByRole('menuitem', { name: 'Odstrániť' }).click();
    await bucket(admin, 'Moje').getByRole('button', { name: 'Odstrániť' }).click();
    await expect(bucket(admin, 'Moje')).toHaveCount(0);
    await expect(bucket(client, 'Moje')).toHaveCount(0);
  } finally {
    await clientContext.close();
  }
});

test('admin creates a task through the full panel and marks it done', async ({ page }) => {
  const stamp = Date.now();
  const created = await page.request.post('/api/groups', {
    data: { name: `E2E Done ${stamp}`, egrantUrl: `https://e2e-done-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string };
  const bucket = (name: string) => page.getByRole('region', { name });

  await page.goto(`/groups/${group.id}/tasks`);
  await bucket('Na spracovanie').getByRole('link', { name: 'Pridať úlohu' }).click();
  const panel = page.getByRole('complementary', { name: 'Úloha' });
  await panel.getByLabel('Názov', { exact: true }).fill('Záverečná správa');
  await panel.getByLabel('Popis', { exact: true }).fill('Skontrolovať **rozpočet**');
  await panel.getByRole('switch', { name: 'Urgentné' }).click();
  await panel.getByRole('textbox', { name: 'Odkaz', exact: true }).fill('https://egrant.sk/vyzvy/');
  await panel.getByRole('button', { name: 'Vytvoriť' }).click();
  await expect(panel).toHaveCount(0);

  const todoCard = bucket('Na spracovanie').getByRole('link', { name: /Záverečná správa/ });
  await expect(todoCard).toBeVisible();
  await bucket('Na spracovanie').getByRole('button', { name: 'Označiť ako hotové' }).click();

  const doneTitle = bucket('Hotové').getByText('Záverečná správa');
  await expect(doneTitle).toBeVisible();
  await expect(doneTitle).toHaveCSS('text-decoration-line', 'line-through');
  await expect(
    bucket('Hotové').getByRole('button', { name: 'Označiť ako nehotové' }),
  ).toBeVisible();
  await expect(bucket('Na spracovanie').getByText('Záverečná správa')).toHaveCount(0);

  // The description was saved with its formatting and shows rendered in the panel.
  await bucket('Hotové')
    .getByRole('link', { name: /Záverečná správa/ })
    .click();
  await expect(panel.locator('strong', { hasText: 'rozpočet' })).toBeVisible();
  // So was the link: it opens in a new tab.
  await expect(panel.getByRole('link', { name: 'Otvoriť odkaz' })).toHaveAttribute(
    'href',
    'https://egrant.sk/vyzvy/',
  );
});

test('the task panel is a full-screen sheet on a phone', async ({ browser }) => {
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
      data: { name: `E2E Mobil ${stamp}`, egrantUrl: `https://e2e-mobil-${stamp}.egrant.sk` },
    });
    const group = (await created.json()) as { id: string };
    await page.goto(`/groups/${group.id}/tasks`);
    await page.getByRole('link', { name: 'Pridať úlohu' }).first().click();
    const panel = page.getByTestId('task-panel');
    await expect(panel.getByLabel('Názov', { exact: true })).toBeVisible();

    // The sheet covers exactly the screen, and neither it nor the page scrolls sideways.
    expect(await panel.boundingBox()).toEqual({ x: 0, y: 0, width: 390, height: 844 });
    const widths = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth,
      panel: document.querySelector('[data-testid="task-panel"]')!.scrollWidth,
      overflow: getComputedStyle(document.documentElement).overflow,
    }));
    expect(widths).toEqual({ page: 390, panel: 390, overflow: 'hidden' });

    // Every control in the sheet is at least 44 px to tap (or has its own 44 px hit area).
    const small = await panel
      .locator('button:not([data-hit]), select, input:not([type=file]), a')
      .evaluateAll((elements) =>
        elements
          .map((e) => ({
            name: e.getAttribute('aria-label') ?? e.textContent,
            r: e.getBoundingClientRect(),
          }))
          .filter(({ r }) => r.width > 0 && (r.height < 44 || r.width < 44))
          .map(({ name }) => name),
      );
    expect(small).toEqual([]);
    // Deadline and Urgent stack: the switch is below the date field.
    const date = (await panel.getByLabel('Termín').boundingBox())!;
    const urgent = (await panel.getByRole('switch', { name: 'Urgentné' }).boundingBox())!;
    expect(urgent.y).toBeGreaterThan(date.y + date.height);
    expect(date.width).toBeGreaterThan(300);
  } finally {
    await context.close();
  }
});
