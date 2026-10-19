import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { createDb, type Db } from '../../infra/db/client.js';
import { feedCallsSql } from '../knowledge/feed.js';
import { feedEventsSql } from '../projects/feed.js';
import { projectVolumeIds } from '../projects/test-volume.js';
import { feedAssignedDeadlinesSql } from '../tasks/feed.js';
import { bratislavaDay } from '../tasks/reminders.js';
import { calendarVolumeIds } from './test-volume.js';

// This run's clones of the projects and calendar volumes' templates (ADR 0040).
const urls = inject('explainDatabaseUrls');
const projectsDb = createDb(urls.projects);
const calendarDb = createDb(urls.calendar);
afterAll(() => Promise.all([projectsDb.close(), calendarDb.close()]));

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };
type Explained = { Plan: PlanNode; 'Execution Time': number };

function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

/**
 * Asserts that `query` reads none of `tables` with a sequential scan (always checked). The bound
 * in milliseconds is wall time, so it only runs with `RUN_BENCH=1`: one warm-up, best of three.
 */
async function expectIndexed(db: Db, query: SQL, tables: string[], ms: number): Promise<void> {
  await db.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < 3; run++) {
    const rows = await db.execute<{ 'QUERY PLAN': [Explained] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const time = Math.min(...plans.map((p) => p['Execution Time']));
  if (process.env.EXPLAIN_DEBUG) console.log(time, JSON.stringify(plans[0], null, 1));
  const scanned = seqScans(plans[0]!.Plan).filter((t) => tables.includes(t));
  expect({ scanned }).toEqual({ scanned: [] });
  if (process.env.RUN_BENCH) expect(time).toBeLessThan(ms);
}

const DAY = 86_400_000;
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** The feed's three reads (spec §8) on seeded volumes: none of them scans a whole table. */
describe('personal calendar feed query plans (ADR 0051)', () => {
  const today = bratislavaDay(new Date());
  const from = addDays(today, -30);
  const to = addDays(today, 365);

  it('feed events read project_events by group and date', { timeout: 300_000 }, async () => {
    const { groupId } = await projectVolumeIds(projectsDb.db);
    const tables = ['projects', 'project_events'];
    // a client of one group, and an admin managing a few
    await expectIndexed(
      projectsDb.db,
      feedEventsSql({ groupIds: [groupId], from, to }),
      tables,
      20,
    );
    const some = [2, 3, 4, 5, 6].map((n) => `pvproj000000-g${n}`);
    await expectIndexed(projectsDb.db, feedEventsSql({ groupIds: some, from, to }), tables, 20);
  });

  it('assigned deadlines start from task_assignees', { timeout: 300_000 }, async () => {
    const { adminId } = await projectVolumeIds(projectsDb.db);
    // An admin's readable groups: every group of the volume. Every row of the volume's
    // task_assignees is this admin's, so reading all of them is the right plan there; tasks
    // are still read by key. A client with a few assignments starts from the index.
    const all = Array.from({ length: 3_100 }, (_, i) => `pvproj000000-g${i + 1}`);
    await expectIndexed(
      projectsDb.db,
      feedAssignedDeadlinesSql({ userId: adminId, groupIds: all, from, to }),
      ['tasks'],
      30,
    );
    await expectIndexed(
      projectsDb.db,
      feedAssignedDeadlinesSql({
        userId: 'pvproj000000-c2',
        groupIds: ['pvproj000000-g2'],
        from,
        to,
      }),
      ['tasks', 'task_assignees'],
      20,
    );
  });

  it('feed calls read knowledge_meetings by start', { timeout: 300_000 }, async () => {
    const { groupIds } = calendarVolumeIds();
    const now = Date.now();
    const window = { from: new Date(now - 30 * DAY), to: new Date(now + 365 * DAY) };
    const tables = ['knowledge_meetings', 'knowledge_items'];
    await expectIndexed(
      calendarDb.db,
      feedCallsSql({ groupIds: [groupIds[1]!], includeAdminsOnly: false, ...window }),
      tables,
      30,
    );
    await expectIndexed(
      calendarDb.db,
      feedCallsSql({ groupIds: groupIds.slice(0, 5), includeAdminsOnly: true, ...window }),
      tables,
      30,
    );
  });
});
