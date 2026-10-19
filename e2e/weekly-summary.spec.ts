import { createRequire } from 'node:module';
import process from 'node:process';
import { expect, test, type APIRequestContext } from '@playwright/test';
import { withDb } from './db';
import { clearMailFor, latestLoginCode, waitForMessage } from './mailpit';

// Weekly client summaries (spec 2026-10-19): a manager reviews, edits and sends the week's draft
// (fake AI); the Italian client gets it in Mailpit with the Italian headings, the edited intro
// and the List-Unsubscribe header; the unsubscribe page names the group; the archive finds the
// report. Run only in the final e2e pass (never concurrently with another worktree).

const MAILPIT = 'http://127.0.0.1:8025';
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_e2e';

type Boss = {
  start(): Promise<unknown>;
  send(name: string, data: object): Promise<unknown>;
  stop(options?: object): Promise<void>;
};
// pg-boss is a dependency of the server package (as `postgres` in db.ts).
const { PgBoss } = createRequire(import.meta.dirname + '/../apps/server/package.json')(
  'pg-boss',
) as { PgBoss: new (options: object) => Boss };

/** Queues the Friday prepare job, as its cron would; the running server's worker runs it. */
async function triggerPrepare(): Promise<void> {
  if (!new URL(databaseUrl).pathname.includes('e2e')) throw new Error('Not the e2e database');
  const boss = new PgBoss({ connectionString: databaseUrl, supervise: false, schedule: false });
  await boss.start();
  try {
    await boss.send('weekly-summary.prepare', {});
  } finally {
    await boss.stop({ graceful: false });
  }
}

async function signIn(request: APIRequestContext, email: string) {
  await clearMailFor(request, email);
  const sent = await request.post('/api/auth/email-otp/send-verification-otp', {
    data: { email, type: 'sign-in' },
  });
  expect(sent.ok()).toBe(true);
  const otp = await latestLoginCode(request, email);
  expect((await request.post('/api/auth/sign-in/email-otp', { data: { email, otp } })).ok()).toBe(
    true,
  );
}

test('a manager reviews, edits and sends the weekly summary', async ({ page, browser }) => {
  test.setTimeout(150_000);
  const stamp = Date.now();
  const groupName = `E2E Týždeň ${stamp}`;
  const client = { email: `e2e-weekly-${stamp}@example.com`, name: `Marco Rossi ${stamp}` };
  const intro = `Buongiorno, settimana ${stamp}`;

  // Setup: a group the admin manages, an Italian client, a completed task and one waiting.
  const created = await page.request.post('/api/groups', {
    data: { name: groupName, egrantUrl: `https://e2e-weekly-${stamp}.egrant.sk` },
  });
  expect(created.status()).toBe(201);
  const group = (await created.json()) as { id: string; inviteUrl: string };
  expect((await page.request.put(`/api/groups/${group.id}/managers/me`)).ok()).toBe(true);
  const inviteToken = new URL(group.inviteUrl).pathname.split('/').pop();
  const context = await browser.newContext({ locale: 'it-IT', storageState: undefined });
  try {
    const request = context.request;
    expect(
      (await request.post(`/api/join/${inviteToken}`, { data: { email: client.email } })).ok(),
    ).toBe(true);
    await signIn(request, client.email);
    expect((await request.patch('/api/me', { data: { name: client.name } })).ok()).toBe(true);
    expect((await request.put('/api/me/language', { data: { language: 'it' } })).ok()).toBe(true);

    const done = await page.request.post(`/api/groups/${group.id}/tasks`, {
      data: { title: `Rozpočet hotový ${stamp}` },
    });
    const waiting = await page.request.post(`/api/groups/${group.id}/tasks`, {
      data: { title: `Podpis zmluvy ${stamp}` },
    });
    const doneId = ((await done.json()) as { id: string }).id;
    const waitingId = ((await waiting.json()) as { id: string }).id;
    await withDb(async (sql) => {
      await sql`update tasks set completed_at = now() - interval '1 day' where id = ${doneId}`;
      await sql`update tasks set bucket_id = (select id from buckets
        where group_id = ${group.id} and kind = 'client_review') where id = ${waitingId}`;
    });

    // The Friday job prepares the draft (fake AI: one item per fact).
    await triggerPrepare();
    await expect
      .poll(
        async () =>
          withDb(async (sql) => {
            const rows =
              await sql`select status from weekly_summaries where group_id = ${group.id}`;
            return rows[0]?.status ?? null;
          }),
        { timeout: 30_000 },
      )
      .toBe('draft');

    // The manager opens the list, the draft, edits the intro, previews and sends.
    await page.goto('/weekly-summaries');
    // The client list in the sidebar has a link with the same name.
    await page
      .getByRole('link', { name: groupName })
      .and(page.locator('[href^="/weekly-summaries/"]'))
      .click();
    await expect(
      page.getByText('Pripravené s AI – pred odoslaním text skontrolujte.'),
    ).toBeVisible();
    await page.getByRole('textbox', { name: 'Úvod' }).fill(intro);
    await page.getByRole('button', { name: 'Uložiť' }).click();
    await page.getByRole('button', { name: 'Náhľad' }).click();
    const frame = page.getByTitle('Náhľad e-mailu');
    await expect(frame).toHaveAttribute('sandbox', '');
    await page.getByRole('button', { name: 'Zavrieť' }).click();
    await clearMailFor(page.request, client.email);
    await page.getByRole('button', { name: 'Poslať klientom' }).click();
    await page.getByTestId('weekly-send').getByRole('button', { name: 'Poslať' }).click();
    await expect(page.getByText(/^Odoslané /).first()).toBeVisible({ timeout: 30_000 });

    // The client's email: Italian headings, the edited intro, the one-click header.
    const message = (await waitForMessage(request, client.email, /Riepilogo settimanale/)) as {
      ID?: string;
      Subject: string;
      Text: string;
    };
    expect(message.Text).toContain(intro);
    expect(message.Text.toLowerCase()).toContain('cosa abbiamo fatto');
    const search = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${client.email}"`)}`,
    );
    const id = ((await search.json()) as { messages: { ID: string }[] }).messages[0]!.ID;
    const headers = (await (
      await request.get(`${MAILPIT}/api/v1/message/${id}/headers`)
    ).json()) as Record<string, string[]>;
    expect(headers['List-Unsubscribe-Post']).toEqual(['List-Unsubscribe=One-Click']);
    expect(headers['List-Unsubscribe']?.[0]).toMatch(
      /\/api\/weekly-summary\/unsubscribe\/.+\/one-click>$/,
    );

    // The unsubscribe page of the footer link names the group.
    const link = /https?:\/\/\S+\/weekly-summary\/unsubscribe\/[A-Za-z0-9._-]+/.exec(
      message.Text,
    )?.[0];
    expect(link, message.Text).toBeTruthy();
    const clientPage = await context.newPage();
    await clientPage.goto(new URL(link!).pathname);
    await expect(clientPage.getByText(new RegExp(groupName))).toBeVisible();

    // The archive finds the report by client and a word of the edited intro.
    await page.goto(
      `/weekly-summaries/archive?groupId=${group.id}&q=${encodeURIComponent(String(stamp))}`,
    );
    await expect(page.getByRole('heading', { name: groupName })).toBeVisible();
    await expect(page.getByText(intro)).toBeVisible();
  } finally {
    await context.close();
  }
});

test('a client never reaches /weekly-summaries or the archive', async ({ page, browser }) => {
  const stamp = Date.now();
  const context = await browser.newContext({ locale: 'sk-SK', storageState: undefined });
  try {
    const request = context.request;
    const email = `e2e-weekly-client-${stamp}@example.com`;
    // A client who joined a group through its invitation.
    const created = await page.request.post('/api/groups', {
      data: { name: `E2E Klient ${stamp}`, egrantUrl: `https://e2e-wc-${stamp}.egrant.sk` },
    });
    const group = (await created.json()) as { inviteUrl: string };
    const token = new URL(group.inviteUrl).pathname.split('/').pop();
    await request.post(`/api/join/${token}`, { data: { email } });
    await signIn(request, email);
    expect((await request.get('/api/weekly-summaries')).status()).toBe(403);
    expect((await request.get('/api/weekly-summaries/archive')).status()).toBe(403);
    const clientPage = await context.newPage();
    await clientPage.goto('/weekly-summaries');
    await expect(clientPage.getByRole('heading', { name: 'Týždenné prehľady' })).toHaveCount(0);
    await clientPage.goto('/weekly-summaries/archive');
    await expect(clientPage.getByRole('heading', { name: 'Archív prehľadov' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
