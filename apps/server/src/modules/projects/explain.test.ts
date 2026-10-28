import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { createDb, type Db } from '../../infra/db/client.js';
import { tasksByEventsSql } from '../tasks/by-event.js';
import { openTasksOfSql } from '../tasks/open-of-group.js';
import { ticketsByEventsSql } from '../tickets/by-event.js';
import { activeTicketsOfSql } from '../tickets/active-of-group.js';
import { projectVolumeIds } from './test-volume.js';
import { bratislavaDay, timelineEventsSql } from './timeline.js';

// This run's clone of the projects volume's template (test/setup-explain-db.ts, ADR 0040).
const { db, close } = createDb(inject('explainDatabaseUrls').projects);
afterAll(() => close());

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
};
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
async function expectIndexed(tx: Db, query: SQL, tables: string[], ms: number): Promise<void> {
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
  if (process.env.RUN_BENCH) expect(time).toBeLessThan(ms);
}

const TABLES = ['projects', 'project_events', 'project_attachments', 'tasks', 'tickets'];
const ASSIGNEES = ['task_assignees', 'ticket_assignees'];

/**
 * Spec §12 on the seeded volume (3 100 groups, 40 000 projects, 400 000 events): the timeline's
 * queries under 50 ms and the active cards under 30 ms (with `RUN_BENCH=1`), none of them
 * scanning a whole table.
 */
describe('Prehľad query plans on a seeded volume (Phase 33 part P4)', () => {
  it('the timeline and the active cards use indexes', { timeout: 300_000 }, async () => {
    const { adminId, groupId, projectId, eventIds } = await projectVolumeIds(db);
    const tx = db;
    const today = bratislavaDay(new Date());
    const page = { around: 'today' as const, limit: 15 };
    // all active projects, chosen projects, all but some, and the next page both ways
    await expectIndexed(tx, timelineEventsSql(groupId, page, today), TABLES, 50);
    await expectIndexed(
      tx,
      timelineEventsSql(groupId, { ...page, project: [projectId, 'x'] }, today),
      TABLES,
      50,
    );
    await expectIndexed(
      tx,
      timelineEventsSql(groupId, { ...page, exclude: [projectId] }, today),
      TABLES,
      50,
    );
    // the test projects too (2026-10-28)
    await expectIndexed(tx, timelineEventsSql(groupId, { ...page, test: '1' }, today), TABLES, 50);
    const cursor = Buffer.from(
      JSON.stringify([today, '2026-01-01T00:00:00.000000Z', 'x']),
    ).toString('base64url');
    for (const dir of ['before', 'after'] as const) {
      await expectIndexed(
        tx,
        timelineEventsSql(groupId, { ...page, [dir]: cursor }, today),
        TABLES,
        50,
      );
    }
    // the rows under a page of events
    await expectIndexed(tx, tasksByEventsSql(groupId, eventIds, 5), [...TABLES, ...ASSIGNEES], 50);
    await expectIndexed(tx, ticketsByEventsSql(groupId, eventIds, 5), TABLES, 50);
    // the active cards read the client's open tasks and active tickets by index; "mine" may
    // hash the admin's assignments (a third of the seeded tasks are theirs), which the planner
    // rightly prefers to one lookup per task, as on the admin home
    await expectIndexed(tx, openTasksOfSql(groupId, adminId, 8), ['tasks'], 30);
    await expectIndexed(tx, activeTicketsOfSql(groupId, adminId, 8), ['tickets'], 30);
  });
});
