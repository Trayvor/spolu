import { afterAll, describe, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import { createDb, type Db } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { dashboardTicketCountSql, dashboardTicketsSql } from '../tickets/dashboard.js';
import { assignedCountSql, assignedSql } from './assigned.js';
import { bratislavaToday, globalBoardSql } from './global-board.js';
import { mentionsSql } from './mentions.js';
import { sidebarSql } from './sidebar.js';
import { withVolume } from './test-volume.js';

// A fresh database of its own (vitest.explain.config.ts); the shared one when run directly.
const { db, close } = createDb(process.env.EXPLAIN_DATABASE_URL ?? testDatabaseUrl);
afterAll(() => close());

type PlanNode = {
  'Node Type': string;
  'Relation Name'?: string;
  Plans?: PlanNode[];
};

function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

type Explained = { Plan: PlanNode; 'Execution Time': number };

/**
 * Runs `query` under `explain (analyze, format json)` and asserts that no table of `tables` is
 * read with a sequential scan and that it runs in under 50 ms. The bound is for a warm, local
 * database: the query runs once to warm the cache, and the best of three timed runs counts, so a
 * busy machine's scheduling noise does not fail it. `EXPLAIN_DEBUG=1` prints the plan.
 */
async function expectIndexed(tx: Db, query: SQL, tables: string[]): Promise<void> {
  await tx.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < 3; run++) {
    const rows = await tx.execute<{ 'QUERY PLAN': [Explained] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const plan = plans[0]!;
  const time = Math.min(...plans.map((p) => p['Execution Time']));
  if (process.env.EXPLAIN_DEBUG) console.log(time, JSON.stringify(plan, null, 1).slice(0, 20000));
  const scanned = seqScans(plan.Plan).filter((t) => tables.includes(t));
  expect({ scanned }).toEqual({ scanned: [] });
  expect(time).toBeLessThan(50);
}

const CHAT_TABLES = ['messages', 'message_mentions'];

/**
 * One seeding (about 20 s) serves every check, so they share one test. The "my assignments"
 * queries may scan `tasks` and `task_assignees`: with a third of the seeded tasks assigned to the
 * one admin, a hash join over the tables is cheaper than thousands of index lookups, and the
 * planner rightly picks it. They still have to stay under 50 ms.
 *
 * Timing on a machine busy with the rest of the suite is noisy: the test retries twice (a new
 * seeding each time) before it fails; a plan with a sequential scan fails every attempt anyway.
 */
describe('admin home query plans on a seeded volume', () => {
  it('the admin home queries use indexes under 50 ms', { timeout: 300_000, retry: 2 }, async () => {
    await withVolume(db, async (tx, { adminId, managedIds }) => {
      // sidebar and assigned use indexes under 50 ms
      await expectIndexed(tx, sidebarSql(adminId), CHAT_TABLES);
      await expectIndexed(tx, assignedSql(adminId), CHAT_TABLES);
      await expectIndexed(tx, assignedCountSql(adminId), CHAT_TABLES);
      // the Tickets card and the header's Tickets count read the tickets indexes; the "no
      // riešiteľ yet" anti-join may hash the small `ticket_assignees` (a few rows per active
      // ticket), which the planner rightly prefers to one index lookup per ticket
      await expectIndexed(tx, dashboardTicketsSql(adminId), ['tickets']);
      await expectIndexed(tx, dashboardTicketCountSql(adminId), ['tickets']);
      // mentions uses indexes under 50 ms
      await expectIndexed(tx, mentionsSql(adminId), CHAT_TABLES);
      // global board uses tasks_open_group_idx under 50 ms, for the 10 managed groups
      // and so does its "only where I take part" filter, and a merged custom column's next page
      const board = {
        clientIds: managedIds,
        viewerId: adminId,
        assignee: 'anyone',
        urgent: false,
        completed: false,
        today: bratislavaToday(new Date()),
      };
      for (const mine of [false, true]) {
        await expectIndexed(tx, globalBoardSql({ ...board, mine }), ['tasks', ...CHAT_TABLES]);
      }
      const after = Buffer.from(
        JSON.stringify([true, '2026-01-01', 'Volume', '2026-01-01T00:00:00Z', '']),
      ).toString('base64url');
      await expectIndexed(
        tx,
        globalBoardSql({ ...board, mine: false, column: 'custom:step 1', after }),
        ['tasks', ...CHAT_TABLES],
      );
    });
  });
});
