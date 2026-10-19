import { expect, test, type Browser } from '@playwright/test';
import { clearMailFor, latestLoginCode } from './mailpit';

// The personal calendar feed (ADR 0051): a client makes the link on /settings, the calendar
// URL answers the .ics without a session, and after "Zrušiť odber" it answers 404.

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

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

test('a client subscribes to their calendar and cancels it', async ({ browser, request }) => {
  const stamp = Date.now();
  const clientEmail = `e2e-calendar-${stamp}@example.com`;
  const eventName = `Odovzdanie ${stamp}`;
  const admin = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
  try {
    const created = await admin.request.post('/api/groups', {
      data: { name: `E2E Kalendár ${stamp}`, egrantUrl: `https://e2e-cal-${stamp}.egrant.sk` },
    });
    expect(created.status()).toBe(201);
    const groupId = ((await created.json()) as { id: string }).id;
    expect(
      (
        await admin.request.post(`/api/groups/${groupId}/members`, {
          data: { email: clientEmail, name: 'E2E Klientka' },
        })
      ).ok(),
    ).toBe(true);
    const project = await admin.request.post(`/api/groups/${groupId}/projects`, {
      data: { name: `Projekt ${stamp}` },
    });
    expect(project.status()).toBe(201);
    const projectId = ((await project.json()) as { id: string }).id;
    const event = await admin.request.post(`/api/projects/${projectId}/events`, {
      data: { name: eventName, occursOn: inDays(10) },
    });
    expect(event.status()).toBe(201);

    const { context, page } = await signIn(browser, clientEmail);
    try {
      await page.goto('/settings');
      const card = page.getByRole('heading', { name: 'Kalendár', level: 2 });
      await expect(card).toBeVisible();
      await page.getByRole('button', { name: 'Vytvoriť odkaz na kalendár' }).click();
      const input = page.getByRole('textbox', { name: 'Odkaz na odber' });
      await expect(input).toHaveValue(/\/api\/public\/calendar\/[A-Za-z0-9_-]{43}\/help\.ics$/);
      const url = await input.inputValue();
      await expect(page.getByRole('link', { name: 'Pridať do Google Kalendára' })).toHaveAttribute(
        'href',
        /^https:\/\/calendar\.google\.com\/calendar\/r\?cid=webcal/,
      );

      // No session: the token is the credential.
      const feed = await request.get(url);
      expect(feed.status()).toBe(200);
      expect(feed.headers()['content-type']).toBe('text/calendar; charset=utf-8');
      const body = await feed.text();
      expect(body).toContain('BEGIN:VCALENDAR');
      expect(body.replace(/\r\n /g, '')).toContain(`SUMMARY:Projekt ${stamp} · ${eventName}`);

      await page.getByRole('button', { name: 'Zrušiť odber' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Zrušiť odber' }).click();
      await expect(page.getByRole('button', { name: 'Vytvoriť odkaz na kalendár' })).toBeVisible();
      expect((await request.get(url)).status()).toBe(404);
    } finally {
      await context.close();
    }
  } finally {
    await admin.close();
  }
});
