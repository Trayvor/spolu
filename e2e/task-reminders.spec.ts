import { readFile } from 'node:fs/promises';
import { expect, test, type BrowserContext } from '@playwright/test';
import type { TaskDetailDto } from '@spolu/shared';
import { withDb } from './db';
import { clearMailFor, latestLoginCode } from './mailpit';
import { fakeSubscription, waitForPush } from './push-log';

// Phase 19 "Done when": a custom task reminder reaches its recipients at its time, shows on the
// card live, and the task exports to a calendar with its deadline. Two contexts: the superadmin
// and a client who joined by invite (one login: production rate limits allow few code requests).
test.describe.serial('task reminders', () => {
  const stamp = Date.now();
  const clientName = `E2E Pripomienky Klient ${stamp}`;
  let groupId = '';
  let adminContext: BrowserContext;
  let clientContext: BrowserContext;
  const endpoint = fakeSubscription();

  test.beforeAll(async ({ browser }) => {
    adminContext = await browser.newContext({ storageState: 'e2e/.auth/superadmin.json' });
    const created = await adminContext.request.post('/api/groups', {
      data: { name: `E2E Pripomienky ${stamp}`, egrantUrl: `https://e2e-rem-${stamp}.egrant.sk` },
    });
    groupId = ((await created.json()) as { id: string }).id;

    const admin = await adminContext.newPage();
    await admin.goto(`/groups/${groupId}/members`);
    const inviteUrl = await admin.getByRole('textbox', { name: 'Odkaz na pozvánku' }).inputValue();
    await admin.close();

    const email = `e2e-rem-${stamp}@example.com`;
    clientContext = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
    const client = await clientContext.newPage();
    await client.goto(new URL(inviteUrl).pathname);
    await clearMailFor(clientContext.request, email);
    await client.getByLabel('E-mail').fill(email);
    await client.getByRole('button', { name: 'Poslať kód' }).click();
    await client.getByLabel('Kód').fill(await latestLoginCode(clientContext.request, email));
    await client.getByLabel('Vaše meno').fill(clientName);
    await client.getByRole('button', { name: 'Pokračovať' }).click();
    await expect(client).toHaveURL(new RegExp(`/groups/${groupId}/chat$`));
    const saved = await client.request.post('/api/push/subscriptions', { data: endpoint });
    expect(saved.status()).toBe(204);
    await client.close();
  });

  test.afterAll(async () => {
    await clientContext?.close();
    await adminContext?.close();
  });

  test('custom task reminder reaches the client, shows on the card and exports with the deadline', async () => {
    test.setTimeout(150_000);
    const title = `Opraviť tabuľku rozpočtu ${stamp}`;
    const due = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    const res = await adminContext.request.post(`/api/groups/${groupId}/tasks`, {
      data: { title, dueDate: due },
    });
    expect(res.status()).toBe(201);
    const task = (await res.json()) as TaskDetailDto;
    const taskUrl = `/groups/${groupId}/tasks/${task.id}`;

    // The client watches the board.
    const client = await clientContext.newPage();
    await client.goto(`/groups/${groupId}/tasks`);
    const clientCard = client.getByRole('link', { name: title });
    await expect(clientCard).toBeVisible();
    await expect(clientCard.getByText('Má pripomienky')).toHaveCount(0);

    // 1. The admin adds a reminder a few minutes ahead (the browser's local date and time).
    const admin = await adminContext.newPage();
    await admin.goto(taskUrl);
    const panel = admin.getByRole('complementary', { name: 'Úloha' });
    await panel.getByRole('button', { name: 'Pridať pripomienku' }).click();
    const { date, time } = await admin.evaluate(() => {
      const d = new Date(Date.now() + 3 * 60_000);
      const pad = (n: number) => String(n).padStart(2, '0');
      return {
        date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
        time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
      };
    });
    await panel.getByLabel('Dátum', { exact: true }).fill(date);
    await panel.getByLabel('Čas', { exact: true }).fill(time);
    await panel.getByRole('button', { name: 'Pridať', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Vymazať pripomienku' })).toHaveCount(1);

    // 2. Under "Change", the admin adds the client and clicks Done.
    await panel.getByRole('button', { name: 'Zmeniť' }).click();
    await panel.getByRole('combobox', { name: 'Príjemcovia' }).click();
    await admin.getByRole('option', { name: new RegExp(clientName) }).click();
    // The multi-select list stays open after a pick and covers Done; close it first.
    await admin.keyboard.press('Escape');
    await panel.getByRole('button', { name: 'Hotovo' }).click();
    await expect(panel.getByTestId('reminder-recipients')).toContainText(clientName);

    // 3. The client's card shows the bell live, without a reload.
    await expect(clientCard.getByText('Má pripomienky')).toHaveCount(1);

    // 7 (before the time fires, while it is still upcoming). The calendar file holds one
    // all-day deadline event and one timed reminder event.
    const [download] = await Promise.all([
      admin.waitForEvent('download'),
      panel.getByRole('link', { name: 'Exportovať do kalendára' }).click(),
    ]);
    const ics = await readFile((await download.path())!, 'utf8');
    expect(ics.match(/DTSTART;VALUE=DATE:/g)).toHaveLength(1);
    expect(ics.match(/UID:reminder-/g)).toHaveLength(1);

    // 4-5. Move the time into the past; the every-minute cron fires it.
    await withDb(
      (sql) => sql`update reminder_times set at = now() - interval '1 second'
        where fired_at is null
          and set_id in (select id from reminder_sets where task_id = ${task.id})`,
    );
    const push = await waitForPush(
      endpoint.endpoint,
      (p) => p.url === taskUrl && p.tag === `task:${task.id}`,
      90_000,
    );
    expect(push.title).toContain(title);

    // 6. The client's bell disappears live.
    await expect(clientCard.getByText('Má pripomienky')).toHaveCount(0);
    await admin.close();
    await client.close();
  });
});
