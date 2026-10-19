import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { createDb, type Db } from '../../infra/db/client.js';
import { clientVisibleMessagesOfSql } from '../chat/weekly-facts.js';
import { upcomingEventsOfSql } from '../projects/weekly-facts.js';
import { doneTasksOfSql, dueTasksOfSql, waitingOnClientTasksOfSql } from '../tasks/weekly-facts.js';
import { resolvedTicketsOfSql } from '../tickets/weekly-facts.js';
import { listArchiveSql } from './archive.js';
import { eligibleGroupsSql } from './jobs.js';
import { listSummariesSql } from './service.js';
import { weeklyVolumeIds } from './test-volume.js';
import { addDays, bratislavaDay, isoWeek } from './week.js';

// This run's clone of the weekly volume's template (test/setup-explain-db.ts, ADR 0040).
const { db, close } = createDb(inject('explainDatabaseUrls').weekly);
afterAll(() => close());

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };
type Explained = { Plan: PlanNode; 'Execution Time': number };

function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

/** No sequential scan of `tables` (always); the bound in ms only with `RUN_BENCH=1`. */
async function expectIndexed(tx: Db, query: SQL, tables: string[], ms: number): Promise<number> {
  await tx.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < 3; run++) {
    const rows = await tx.execute<{ 'QUERY PLAN': [Explained] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const time = Math.min(...plans.map((p) => p['Execution Time']));
  if (process.env.EXPLAIN_DEBUG) console.log(time, JSON.stringify(plans[0], null, 1));
  const scanned = seqScans(plans[0]!.Plan).filter((t) => tables.includes(t));
  expect({ scanned }).toEqual({ scanned: [] });
  if (process.env.RUN_BENCH) {
    console.info(`weekly summary explain: ${time.toFixed(1)} ms (bound ${ms})`);
    expect(time).toBeLessThan(ms);
  }
  return time;
}

const SOURCES = [
  'groups',
  'tasks',
  'tickets',
  'project_events',
  'projects',
  'messages',
  'channels',
];
const SUMMARIES = ['weekly_summaries', 'groups'];

/**
 * Spec §9 on the seeded volume: the eligibility query, the six source queries, the list page
 * and the three archive shapes read by index (with `RUN_BENCH=1`: sources and archive pages
 * under 30 ms, the text query under 100 ms, the eligibility query under 200 ms).
 */
describe('weekly summary query plans on a seeded volume (2026-10-19)', () => {
  it('weekly summary queries use indexes on the seeded volume', { timeout: 300_000 }, async () => {
    const { adminId, groupId, managedIds } = weeklyVolumeIds();
    const now = new Date();
    const from = new Date(now.getTime() - 7 * 86_400_000);
    const today = bratislavaDay(now);
    // The eligibility needs every client group, so it reads `groups`, `group_managers` and
    // `group_members` once each (a hash semi-join is the cheapest way to check 3 100 groups);
    // the 483 600 summaries only by `weekly_summaries_group_week_unique`.
    await expectIndexed(db, eligibleGroupsSql(isoWeek(now)), ['weekly_summaries'], 200);
    await expectIndexed(db, doneTasksOfSql(groupId, from, now), SOURCES, 30);
    await expectIndexed(db, resolvedTicketsOfSql(groupId, from, now), SOURCES, 30);
    await expectIndexed(db, waitingOnClientTasksOfSql(groupId), [...SOURCES, 'buckets'], 30);
    await expectIndexed(
      db,
      dueTasksOfSql(groupId, addDays(today, 1), addDays(today, 14)),
      SOURCES,
      30,
    );
    await expectIndexed(
      db,
      upcomingEventsOfSql(groupId, addDays(today, 1), addDays(today, 14)),
      SOURCES,
      30,
    );
    await expectIndexed(db, clientVisibleMessagesOfSql(groupId, from, now, 150), SOURCES, 30);
    // the list page of a week with rows: the admin's 100 groups, and all 3 100. The page is
    // ordered by group name, so the planner may hash the (small) groups table instead of 100
    // primary key lookups; the summaries are read by `weekly_summaries_week_status_group_idx`.
    const lastWeek = isoWeek(new Date(now.getTime() - 7 * 86_400_000));
    await expectIndexed(
      db,
      listSummariesSql(lastWeek, managedIds, managedIds, 'all', null, 51),
      ['weekly_summaries'],
      30,
    );
    await expectIndexed(
      db,
      listSummariesSql(lastWeek, null, managedIds, 'review', null, 51),
      ['weekly_summaries'],
      30,
    );
    void adminId;
    // the archive: one client and a range, all clients and a range, a text query
    const base = { status: 'all' as const, limit: 20 };
    await expectIndexed(
      db,
      listArchiveSql({ ...base, groupId, from: '2025-03-01', to: '2025-06-30' }, null, 21),
      SUMMARIES,
      30,
    );
    await expectIndexed(
      db,
      listArchiveSql({ ...base, from: '2025-03-01', to: '2025-06-30' }, null, 21),
      SUMMARIES,
      30,
    );
    await expectIndexed(
      db,
      listArchiveSql({ ...base, q: 'monitorovacia sprava' }, null, 21),
      SUMMARIES,
      100,
    );
  });
});
