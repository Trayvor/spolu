import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { WeeklySummaryEvents } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { insertTask } from '../../../test/tasks.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import {
  createFakeWeeklySummary,
  type WeeklySummaryProvider,
  type WeeklySummaryRequest,
} from '../ai/weekly-summary.js';
import { ADMINS_ROOM } from '../../infra/realtime/rooms.js';
import { groups } from '../groups/schema.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { tasks } from '../tasks/schema.js';
import { collectFacts } from './facts.js';
import { factsDraft } from './facts-draft.js';
import { draftLanguage, prepareWeek, runDraft, sweepStuck, WS_DRAFT_JOB } from './jobs.js';
import { weeklySummaries, weeklySummaryGroupSettings } from './schema.js';
import { weeklyHarness } from './test-harness.js';
import {
  insertSummary,
  makeAdmin,
  makeClient,
  makeGroup,
  makeManager,
  sampleContent,
} from './test-fixtures.js';
import { bratislavaDay, isoWeek, rangeText } from './week.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const DAY = 86_400_000;

/** A client group with a manager and one verified client. */
async function setup(language: 'sk' | 'it' = 'sk') {
  const g = await makeGroup(db);
  const manager = await makeManager(db, g.id);
  const client = await makeClient(db, g.id, { language });
  return { g, manager, client };
}

/** A completed task inside this week's window, so the group has activity. */
async function activity(groupId: string, createdBy: string, title = 'Rozpočet') {
  const id = await insertTask(db, { groupId, createdBy, title });
  await db
    .update(tasks)
    .set({ completedAt: new Date(Date.now() - DAY) })
    .where(eq(tasks.id, id));
  return id;
}

const rowsOf = (groupId: string) =>
  db.select().from(weeklySummaries).where(eq(weeklySummaries.groupId, groupId));

/** A provider that records its requests. */
function spyProvider(inner: WeeklySummaryProvider = createFakeWeeklySummary()) {
  const calls: WeeklySummaryRequest[] = [];
  const provider: WeeklySummaryProvider = {
    async draft(request, signal) {
      calls.push(request);
      return inner.draft(request, signal);
    },
  };
  return { provider, calls };
}

describe('weekly summary prepare and draft jobs', () => {
  it('prepare makes one preparing row per eligible group and a draft job each', async () => {
    const a = await setup();
    const b = await setup();
    const { deps, sent } = weeklyHarness(db);
    const before = sent.length;
    const now = new Date();
    expect(await prepareWeek(deps, now, { groupIds: [a.g.id, b.g.id] })).toBe(2);
    expect(sent.slice(before).filter((s) => s.name === WS_DRAFT_JOB)).toHaveLength(2);
    for (const { g } of [a, b]) {
      const rows = await rowsOf(g.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]!.week).toBe(isoWeek(now));
      // no activity: the draft job skipped it
      expect(rows[0]).toMatchObject({ status: 'skipped', skipReason: 'no_activity' });
    }
  });

  it('prepare skips the admin group, deactivated groups, groups turned off, groups with no manager and groups with no recipient', async () => {
    const [adminGroup] = await db.select().from(groups).where(eq(groups.kind, 'admin'));
    const deactivated = await setup();
    await db
      .update(groups)
      .set({ deactivatedAt: new Date() })
      .where(eq(groups.id, deactivated.g.id));
    const off = await setup();
    await db.insert(weeklySummaryGroupSettings).values({ groupId: off.g.id, enabled: false });
    const noManager = await makeGroup(db);
    await makeClient(db, noManager.id);
    const noRecipient = await makeGroup(db);
    await makeManager(db, noRecipient.id);
    await makeClient(db, noRecipient.id, { verified: false });
    await makeClient(db, noRecipient.id, { role: 'ziadatel' });
    const ok = await setup();
    const { deps } = weeklyHarness(db);
    const scope = [deactivated.g.id, off.g.id, noManager.id, noRecipient.id, ok.g.id];
    if (adminGroup) scope.push(adminGroup.id);
    expect(await prepareWeek(deps, new Date(), { groupIds: scope })).toBe(1);
    expect(await rowsOf(ok.g.id)).toHaveLength(1);
  });

  it('prepare twice makes one row per group', async () => {
    const a = await setup();
    const { deps, sent } = weeklyHarness(db);
    const now = new Date();
    expect(await prepareWeek(deps, now, { groupIds: [a.g.id] })).toBe(1);
    const jobs = sent.length;
    expect(await prepareWeek(deps, now, { groupIds: [a.g.id] })).toBe(0);
    expect(sent.length).toBe(jobs);
    expect(await rowsOf(a.g.id)).toHaveLength(1);
  });

  it("prepare never touches earlier weeks' rows", async () => {
    const a = await setup();
    const now = new Date();
    const edited = sampleContent('Ručne upravený bod');
    const oldDraft = await insertSummary(db, {
      groupId: a.g.id,
      week: isoWeek(new Date(now.getTime() - 7 * DAY)),
      windowEnd: new Date(now.getTime() - 7 * DAY),
      content: edited,
      version: 3,
    });
    const sent = await insertSummary(db, {
      groupId: a.g.id,
      week: isoWeek(new Date(now.getTime() - 14 * DAY)),
      windowEnd: new Date(now.getTime() - 14 * DAY),
      status: 'sent',
      sentAt: new Date(now.getTime() - 14 * DAY),
    });
    const skipped = await insertSummary(db, {
      groupId: a.g.id,
      week: isoWeek(new Date(now.getTime() - 21 * DAY)),
      windowEnd: new Date(now.getTime() - 21 * DAY),
      status: 'skipped',
      skipReason: 'manager',
    });
    const before = await rowsOf(a.g.id);
    const { deps } = weeklyHarness(db);
    expect(await prepareWeek(deps, now, { groupIds: [a.g.id] })).toBe(1);
    const after = await rowsOf(a.g.id);
    expect(after).toHaveLength(4);
    for (const id of [oldDraft, sent, skipped]) {
      expect(after.find((r) => r.id === id)).toEqual(before.find((r) => r.id === id));
    }
    expect(after.find((r) => r.id === oldDraft)).toMatchObject({
      status: 'draft',
      version: 3,
      content: edited,
    });
    // the new week starts where the latest row ended
    const fresh = after.find((r) => r.week === isoWeek(now))!;
    expect(fresh.windowStart).toEqual(new Date(now.getTime() - 7 * DAY));
  });

  it('a group with no activity is skipped without an AI call', async () => {
    const a = await setup();
    const { provider, calls } = spyProvider();
    const { deps } = weeklyHarness(db, { ai: provider });
    await prepareWeek(deps, new Date(), { groupIds: [a.g.id] });
    expect(calls).toHaveLength(0);
    const [row] = await rowsOf(a.g.id);
    expect(row).toMatchObject({ status: 'skipped', skipReason: 'no_activity' });
  });

  it('the draft uses the AI answer', async () => {
    const a = await setup();
    const taskId = await activity(a.g.id, a.manager.id);
    const { provider, calls } = spyProvider();
    const { deps } = weeklyHarness(db, { ai: provider });
    await prepareWeek(deps, new Date(), { groupIds: [a.g.id] });
    expect(calls).toHaveLength(1);
    const [row] = await rowsOf(a.g.id);
    expect(row).toMatchObject({ status: 'draft', source: 'ai', aiFailed: false, version: 2 });
    expect(row!.content.intro).toBe('Fake intro');
    expect(row!.content.done.map((i) => i.ref)).toEqual([{ kind: 'task', id: taskId }]);
    expect(row!.searchText).toContain('Rozpočet');
  });

  it('falls back to facts on timeout', async () => {
    const a = await setup();
    await activity(a.g.id, a.manager.id);
    const never: WeeklySummaryProvider = { draft: () => new Promise(() => {}) };
    const { deps } = weeklyHarness(db, { ai: never, aiTimeoutMs: 50 });
    const now = new Date();
    await prepareWeek(deps, now, { groupIds: [a.g.id] });
    const [row] = await rowsOf(a.g.id);
    expect(row).toMatchObject({ status: 'draft', source: 'facts', aiFailed: true });
    const facts = await collectFacts(
      db,
      a.g.id,
      { start: row!.windowStart, end: row!.windowEnd },
      bratislavaDay(now),
    );
    const expected = factsDraft(facts, 'sk', rangeText('sk', row!.windowStart, row!.windowEnd));
    const strip = (c: typeof expected) => ({
      ...c,
      done: c.done.map(({ ref, text }) => ({ ref, text })),
      waiting: c.waiting.map(({ ref, text }) => ({ ref, text })),
      upcoming: c.upcoming.map(({ ref, text }) => ({ ref, text })),
    });
    expect(strip(row!.content)).toEqual(strip(expected));
  });

  it('AI off gives a factual draft without the failure flag', async () => {
    const a = await setup();
    await activity(a.g.id, a.manager.id);
    const { deps } = weeklyHarness(db, { ai: null });
    await prepareWeek(deps, new Date(), { groupIds: [a.g.id] });
    const [row] = await rowsOf(a.g.id);
    expect(row).toMatchObject({ status: 'draft', source: 'facts', aiFailed: false });
  });

  it('admin-only knowledge and finance never reach the AI', async () => {
    const a = await setup();
    await activity(a.g.id, a.manager.id);
    await db.insert(knowledgeItems).values({
      id: randomUUID(),
      groupId: a.g.id,
      type: 'note',
      visibility: 'admins',
      title: 'TAJNÁ-INTERNÁ-POZNÁMKA',
      searchText: '',
      createdBy: a.manager.id,
    });
    const { provider, calls } = spyProvider();
    const { deps } = weeklyHarness(db, { ai: provider });
    await prepareWeek(deps, new Date(), { groupIds: [a.g.id] });
    const sentText = JSON.stringify(calls);
    expect(sentText).not.toContain('TAJNÁ-INTERNÁ-POZNÁMKA');
    expect(sentText).not.toContain('@example.com');
    expect(sentText).not.toContain(a.client.id);
  });

  it("the draft language is the recipients' majority", async () => {
    const a = await setup('it');
    await makeClient(db, a.g.id, { language: 'it' });
    await makeClient(db, a.g.id, { language: 'sk' });
    await activity(a.g.id, a.manager.id);
    const { deps } = weeklyHarness(db);
    await prepareWeek(deps, new Date(), { groupIds: [a.g.id] });
    const [row] = await rowsOf(a.g.id);
    expect(row!.language).toBe('it');
    expect(draftLanguage([])).toBe('sk');
    expect(draftLanguage(['it', 'en'])).toBe('sk');
    expect(draftLanguage(['en', 'en', 'it'])).toBe('en');
  });

  it('the sweep re-sends a job for a row stuck in preparing for over 10 minutes', async () => {
    const a = await setup();
    const now = new Date();
    const stuck = await insertSummary(db, {
      groupId: a.g.id,
      week: isoWeek(now),
      status: 'preparing',
      content: { intro: '', done: [], waiting: [], upcoming: [], closing: '' },
      updatedAt: new Date(now.getTime() - 11 * 60_000),
    });
    const fresh = await insertSummary(db, {
      groupId: a.g.id,
      week: isoWeek(new Date(now.getTime() - 7 * DAY)),
      windowEnd: new Date(now.getTime() - 7 * DAY),
      status: 'preparing',
      content: { intro: '', done: [], waiting: [], upcoming: [], closing: '' },
    });
    const { deps, sent } = weeklyHarness(db);
    await sweepStuck(deps, now);
    const draftJobs = sent.filter((s) => s.name === WS_DRAFT_JOB).map((s) => s.data);
    expect(draftJobs).toContainEqual({ summaryId: stuck });
    expect(draftJobs).not.toContainEqual({ summaryId: fresh });
    const [row] = await db.select().from(weeklySummaries).where(eq(weeklySummaries.id, stuck));
    expect(row!.status).not.toBe('preparing');
  });

  it('every state change emits weekly-summary:changed to the admins room', async () => {
    const a = await setup();
    await activity(a.g.id, a.manager.id);
    const { deps, emitted } = weeklyHarness(db);
    await prepareWeek(deps, new Date(), { groupIds: [a.g.id] });
    const [row] = await rowsOf(a.g.id);
    expect(emitted).toContainEqual({
      room: ADMINS_ROOM,
      event: WeeklySummaryEvents.changed,
      payload: {
        id: row!.id,
        groupId: a.g.id,
        week: row!.week,
        status: 'draft',
        version: row!.version,
      },
    });
  });

  it('a retried draft job leaves a finished row alone', async () => {
    const a = await setup();
    await activity(a.g.id, a.manager.id);
    const { deps } = weeklyHarness(db);
    await prepareWeek(deps, new Date(), { groupIds: [a.g.id] });
    const [row] = await rowsOf(a.g.id);
    await runDraft(deps, row!.id);
    const [again] = await db
      .select()
      .from(weeklySummaries)
      .where(and(eq(weeklySummaries.id, row!.id)));
    expect(again).toEqual(row);
    await makeAdmin(db);
  });
});
