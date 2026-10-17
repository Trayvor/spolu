import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

// Phase 33 end-to-end scenarios (spec §14). Part P1 writes the projects' life below (the plan's
// "Done when" of P1, without the merge, which is part P3's); part P4 adds scenarios 1, 6 and 7.
// One serial flow: production rate limits allow only a few code requests per minute.

/** Signs `email` in, in a new Slovak browser context. */
async function signIn(browser: Browser, email: string) {
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  const page = await context.newPage();
  await page.goto(`/login?email=${encodeURIComponent(email)}`);
  await clearMailFor(context.request, email);
  await page.getByRole('button', { name: 'Poslať kód' }).click();
  await page.getByLabel('Kód').fill(await latestLoginCode(context.request, email));
  await expect(page).not.toHaveURL(/\/login/);
  return { context, page };
}

test.describe.serial('projects: the Prehľad tab (P1)', () => {
  const stamp = Date.now();
  const projectName = `Kultúra ${stamp}`;
  const clientEmail = `e2e-projects-${stamp}@example.com`;
  let groupId = '';
  let admin: BrowserContext;

  test.beforeAll(async ({ browser }) => {
    admin = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const created = await admin.request.post('/api/groups', {
      data: { name: `E2E Projekty ${stamp}`, egrantUrl: `https://e2e-prj-${stamp}.egrant.sk` },
    });
    expect(created.status()).toBe(201);
    groupId = ((await created.json()) as { id: string }).id;
    const invited = await admin.request.post(`/api/groups/${groupId}/members`, {
      data: { email: clientEmail, name: 'E2E Klientka' },
    });
    expect(invited.ok()).toBe(true);
  });
  test.afterAll(async () => {
    await admin.close();
  });

  test('an admin creates a project with a file and two events', async () => {
    const page = await admin.newPage();
    await page.goto(`/groups/${groupId}/chat`);
    // Prehľad is the first tab pill; the group still opens on Chat.
    const tabs = page.getByRole('navigation', { name: 'Časti skupiny' });
    await expect(tabs.getByRole('link').first()).toHaveText('Prehľad');
    await tabs.getByRole('link', { name: 'Prehľad' }).click();
    await expect(page).toHaveURL(/\/overview$/);

    const card = page.getByRole('region', { name: 'Projekty' });
    await expect(card.getByText(/Zatiaľ žiadne projekty/)).toBeVisible();
    await card.getByRole('button', { name: 'Nový projekt' }).click();
    const dialog = page.getByTestId('project-dialog');
    await dialog.getByLabel('Názov', { exact: true }).fill(projectName);
    await dialog.getByTestId('project-file-input').setInputFiles({
      name: `vyzva-${stamp}.pdf`,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\nvyzva\n'),
    });
    await expect(
      dialog.getByRole('link', { name: new RegExp(`vyzva-${stamp}\\.pdf`) }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Vytvoriť' }).click();

    // The new project opens in its sheet.
    const sheet = page.getByTestId('project-sheet');
    await expect(sheet.getByRole('heading', { name: projectName })).toBeVisible();
    await expect(sheet.getByRole('link', { name: new RegExp(`vyzva-${stamp}`) })).toBeVisible();
    const year = new Date().getFullYear();
    for (const [name, day] of [
      ['Kickoff', `${year - 1}-03-12`],
      ['Hodnotenie', `${year + 1}-11-04`],
    ] as const) {
      await sheet.getByRole('button', { name: 'Pridať udalosť' }).click();
      const event = page.getByTestId('event-dialog');
      await event.getByLabel('Názov', { exact: true }).fill(name);
      await event.getByLabel('Dátum').fill(day);
      await event.getByRole('button', { name: 'Vytvoriť' }).click();
      await expect(event).toHaveCount(0);
      await expect(sheet.getByRole('button', { name: new RegExp(name) })).toBeVisible();
    }
    await sheet.getByRole('button', { name: 'Zavrieť' }).click();
    const row = card.getByRole('button', { name: new RegExp(projectName) });
    await expect(row).toContainText('2 udalosti');
    await expect(row).toContainText('Ďalšia: Hodnotenie');
    await page.close();
  });

  test('the client sees it, adds a third event and archives the project', async ({ browser }) => {
    const { context, page } = await signIn(browser, clientEmail);
    try {
      await page.goto(`/groups/${groupId}/overview`);
      const card = page.getByRole('region', { name: 'Projekty' });
      await card.getByRole('button', { name: new RegExp(projectName) }).click();
      const sheet = page.getByTestId('project-sheet');
      await sheet.getByRole('button', { name: 'Pridať udalosť' }).click();
      const event = page.getByTestId('event-dialog');
      await event.getByLabel('Názov', { exact: true }).fill('Správa');
      await event.getByLabel('Dátum').fill(`${new Date().getFullYear() + 2}-01-15`);
      await event.getByRole('button', { name: 'Vytvoriť' }).click();
      await expect(sheet.getByRole('button', { name: /Správa/ })).toBeVisible();

      await sheet.getByRole('button', { name: 'Akcie projektu' }).click();
      await page.getByRole('menuitem', { name: 'Archivovať' }).click();
      await expect(sheet.getByText('Archivovaný')).toBeVisible();
      await sheet.getByRole('button', { name: 'Zavrieť' }).click();
      await expect(card.getByRole('button', { name: new RegExp(projectName) })).toHaveCount(0);
      await card.getByRole('radio', { name: 'Archivované' }).click();
      await expect(card.getByRole('button', { name: new RegExp(projectName) })).toContainText(
        '3 udalosti',
      );
    } finally {
      await context.close();
    }
  });

  test('a žiadateľ or another client reaches none of it', async ({ browser }) => {
    const other = await admin.request.post('/api/groups', {
      data: { name: `E2E Iná ${stamp}`, egrantUrl: `https://e2e-prj-o-${stamp}.egrant.sk` },
    });
    const otherId = ((await other.json()) as { id: string }).id;
    const outsiderEmail = `e2e-projects-out-${stamp}@example.com`;
    await admin.request.post(`/api/groups/${otherId}/members`, { data: { email: outsiderEmail } });
    const { context, page } = await signIn(browser, outsiderEmail);
    try {
      expect((await context.request.get(`/api/groups/${groupId}/projects`)).status()).toBe(404);
      await page.goto(`/groups/${groupId}/overview`);
      await expect(page.getByRole('heading', { name: 'Stránka sa nenašla' })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
