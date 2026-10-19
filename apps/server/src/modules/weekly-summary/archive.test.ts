import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  WeeklySummaryArchiveQuerySchema,
  type WeeklySummaryArchive,
  type WeeklySummaryArchiveQuery,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { setGroupDeactivated } from '../groups/service.js';
import { deactivateUser } from '../users/service.js';
import { listArchive } from './archive.js';
import { prepareWeek } from './jobs.js';
import { weeklyHarness } from './test-harness.js';
import {
  insertSummary,
  makeAdmin,
  makeClient,
  makeGroup,
  makeManager,
  sampleContent,
} from './test-fixtures.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const DAY = 86_400_000;
const at = (day: string) => new Date(`${day}T05:00:00Z`);

describe('the archive of weekly summaries', () => {
  let test: TestApp;
  const admins: string[] = [];
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });
  const db = () => test.deps.db;
  const query = (q: Partial<Record<keyof WeeklySummaryArchiveQuery, string>>) =>
    WeeklySummaryArchiveQuerySchema.parse(q);
  const ids = (page: WeeklySummaryArchive) => page.items.map((i) => i.id);

  it('the archive keeps every week of a client', async () => {
    const g = await makeGroup(db());
    await makeManager(db(), g.id);
    await makeClient(db(), g.id);
    const sent = await insertSummary(db(), {
      groupId: g.id,
      week: '2026-W40',
      status: 'sent',
      windowEnd: at('2026-10-02'),
      sentAt: at('2026-10-02'),
    });
    const unsent = await insertSummary(db(), {
      groupId: g.id,
      week: '2026-W41',
      windowEnd: at('2026-10-09'),
    });
    const skipped = await insertSummary(db(), {
      groupId: g.id,
      week: '2026-W42',
      status: 'skipped',
      skipReason: 'manager',
      windowEnd: at('2026-10-16'),
    });
    const before = await listArchive(db(), query({ groupId: g.id }));
    const { deps } = weeklyHarness(db());
    await prepareWeek(deps, new Date(), { groupIds: [g.id] });
    await prepareWeek(deps, new Date(), { groupIds: [g.id] });
    const after = await listArchive(db(), query({ groupId: g.id }));
    expect(ids(before)).toEqual([skipped, unsent, sent]);
    expect(ids(after).slice(-3)).toEqual([skipped, unsent, sent]);
  });

  it('a date range finds every week that overlaps it', async () => {
    const g = await makeGroup(db());
    const week = (start: string, end: string, w: string) =>
      insertSummary(db(), { groupId: g.id, week: w, windowStart: at(start), windowEnd: at(end) });
    await week('2026-02-21', '2026-02-28', '2026-W09');
    const march = await week('2026-02-27', '2026-03-06', '2026-W10');
    const june = await week('2026-06-23', '2026-06-30', '2026-W27');
    await week('2026-07-01', '2026-07-07', '2026-W28');
    const page = await listArchive(
      db(),
      query({ groupId: g.id, from: '2026-03-01', to: '2026-06-30' }),
    );
    expect(ids(page)).toEqual([june, march]);
  });

  it("the client filter lists only that group's reports", async () => {
    const [a, b] = [await makeGroup(db()), await makeGroup(db())];
    const mine = await insertSummary(db(), { groupId: a.id, week: '2026-W30' });
    await insertSummary(db(), { groupId: b.id, week: '2026-W30' });
    expect(ids(await listArchive(db(), query({ groupId: a.id })))).toEqual([mine]);
  });

  it('text search folds diacritics and case', async () => {
    const g = await makeGroup(db());
    const tag = randomUUID().slice(0, 8);
    const hit = await insertSummary(db(), {
      groupId: g.id,
      week: '2026-W31',
      content: sampleContent(`Podali sme žiadosť o platbu ${tag}`),
    });
    await insertSummary(db(), {
      groupId: g.id,
      week: '2026-W32',
      content: sampleContent('Zníženie o 100 eur'),
    });
    const percent = await insertSummary(db(), {
      groupId: g.id,
      week: '2026-W33',
      content: sampleContent('Zľava 100% hotová'),
    });
    expect(
      ids(await listArchive(db(), query({ groupId: g.id, q: `ZIADOST o platbu ${tag}` }))),
    ).toEqual([hit]);
    expect(ids(await listArchive(db(), query({ groupId: g.id, q: 'ziadost' })))).toEqual([hit]);
    expect(ids(await listArchive(db(), query({ groupId: g.id, q: '100%' })))).toEqual([percent]);
  });

  it('status=sent lists only sent, status=unsent lists draft, sending and skipped', async () => {
    const g = await makeGroup(db());
    const rows: Record<string, string> = {};
    for (const [i, status] of (
      ['preparing', 'draft', 'sending', 'sent', 'skipped'] as const
    ).entries()) {
      rows[status] = await insertSummary(db(), {
        groupId: g.id,
        week: `2026-W2${i}`,
        status,
        windowEnd: new Date(Date.now() - (10 - i) * DAY),
      });
    }
    expect(ids(await listArchive(db(), query({ groupId: g.id, status: 'sent' })))).toEqual([
      rows.sent,
    ]);
    expect(ids(await listArchive(db(), query({ groupId: g.id, status: 'unsent' })))).toEqual([
      rows.skipped,
      rows.sending,
      rows.draft,
    ]);
    expect(ids(await listArchive(db(), query({ groupId: g.id })))).not.toContain(rows.preparing);
  });

  it('pages are keyset by window_end and id', async () => {
    const g = await makeGroup(db());
    const end = new Date('2025-06-01T05:00:00Z');
    for (let i = 0; i < 45; i++) {
      await insertSummary(db(), {
        groupId: g.id,
        week: `2025-W${String((i % 52) + 1).padStart(2, '0')}`,
        // pairs share a window end, so the id decides
        windowEnd: new Date(end.getTime() + Math.floor(i / 2) * DAY),
      });
    }
    const seen: string[] = [];
    const sizes: number[] = [];
    let cursor: string | undefined;
    do {
      const page = await listArchive(
        db(),
        query({ groupId: g.id, limit: '20', ...(cursor ? { cursor } : {}) }),
      );
      sizes.push(page.items.length);
      seen.push(...ids(page));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(sizes).toEqual([20, 20, 5]);
    expect(new Set(seen).size).toBe(45);
  });

  it('from after to is 400 validation_failed; a one-character q is 400; an unknown groupId is 404', async () => {
    const a = await makeAdmin(db());
    admins.push(a.id);
    const cookie = await loginAs(test.app, a.email);
    const get = (qs: string) =>
      test.app.inject({
        method: 'GET',
        url: `/api/weekly-summaries/archive?${qs}`,
        headers: { cookie },
      });
    const reversed = await get('from=2026-06-30&to=2026-03-01');
    expect(reversed.statusCode).toBe(400);
    expect(reversed.json()).toEqual({ error: 'validation_failed' });
    expect((await get('q=a')).statusCode).toBe(400);
    expect((await get(`groupId=${randomUUID()}`)).statusCode).toBe(404);
    expect((await get('cursor=bad')).statusCode).toBe(400);
  });

  it('every admin reads the archive, managers and non-managers alike; a client gets 403; no session 401', async () => {
    const g = await makeGroup(db());
    const manager = await makeManager(db(), g.id);
    const other = await makeAdmin(db());
    admins.push(manager.id, other.id);
    const client = await makeClient(db(), g.id);
    const id = await insertSummary(db(), { groupId: g.id, week: '2026-W35' });
    for (const person of [manager, other]) {
      const cookie = await loginAs(test.app, person.email);
      const res = await test.app.inject({
        method: 'GET',
        url: `/api/weekly-summaries/archive?groupId=${g.id}`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(200);
      expect(ids(res.json<WeeklySummaryArchive>())).toEqual([id]);
    }
    const clientCookie = await loginAs(test.app, client.email);
    const forbidden = await test.app.inject({
      method: 'GET',
      url: '/api/weekly-summaries/archive',
      headers: { cookie: clientCookie },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(
      (await test.app.inject({ method: 'GET', url: '/api/weekly-summaries/archive' })).statusCode,
    ).toBe(401);
  });

  it("a deactivated group's reports stay in the archive", async () => {
    const g = await makeGroup(db(), 'Zrušená firma');
    const id = await insertSummary(db(), { groupId: g.id, week: '2026-W36', status: 'sent' });
    await setGroupDeactivated(db(), g.id, true);
    const page = await listArchive(db(), query({ groupId: g.id }));
    expect(ids(page)).toEqual([id]);
    expect(page.items[0]).toMatchObject({ groupDeactivated: true, groupName: 'Zrušená firma' });
  });

  it('the answer never carries search_text or recipient emails', async () => {
    const g = await makeGroup(db());
    const client = await makeClient(db(), g.id);
    await insertSummary(db(), { groupId: g.id, week: '2026-W37', status: 'sent' });
    const page = await listArchive(db(), query({ groupId: g.id }));
    const json = JSON.stringify(page);
    expect(json).not.toContain('search_text');
    expect(json).not.toContain('searchText');
    expect(json).not.toContain(client.email);
  });
});
