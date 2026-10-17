import { afterAll, describe, expect, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { Month } from '@spolu/shared';
import { createDb, type Db } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import {
  countedEntriesSql,
  dataMonthRangeSql,
  dayBounds,
  moneySql,
  monthsBack,
  timeTotalsSql,
} from './aggregates.js';
import { financeToday } from './rates.js';
import { withFinanceVolume } from './test-volume.js';
import { encodeCursor, workLogEntriesSql } from './work-log.js';

// A fresh database of its own (vitest.explain.config.ts); the shared one when run directly.
const { db, close } = createDb(process.env.EXPLAIN_DATABASE_URL ?? testDatabaseUrl);
afterAll(() => close());

type PlanNode = { 'Node Type': string; 'Relation Name'?: string; Plans?: PlanNode[] };
type Explained = { Plan: PlanNode; 'Execution Time': number };

function seqScans(node: PlanNode): string[] {
  const own =
    node['Node Type'] === 'Seq Scan' && node['Relation Name'] ? [node['Relation Name']] : [];
  return [...own, ...(node.Plans ?? []).flatMap(seqScans)];
}

/**
 * The tables that grow. `finance_rates` (a few rows per admin, 200 here) is read whole once per
 * query by `costSql`, which turns it into day ranges: a sequential scan of it is the plan.
 */
const FINANCE_TABLES = ['finance_time_entries', 'finance_items'];

/** The measured times, printed at the end for `architecture/performance.md`. */
const timings: [string, number][] = [];

/**
 * Runs `query` under `explain (analyze, format json)`: no finance table read with a sequential
 * scan, and under `limitMs` (spec §10: a client's overview and work-log page under 50 ms). Warm
 * once, best of three, as `home/explain.test.ts`. `EXPLAIN_DEBUG=1` prints the plan.
 */
async function expectIndexed(tx: Db, name: string, query: SQL, limitMs = 50): Promise<void> {
  await tx.execute(query);
  const plans: Explained[] = [];
  for (let run = 0; run < 3; run++) {
    const rows = await tx.execute<{ 'QUERY PLAN': [Explained] }>(
      sql`explain (analyze, format json) ${query}`,
    );
    plans.push([...rows][0]!['QUERY PLAN'][0]);
  }
  const time = Math.min(...plans.map((p) => p['Execution Time']));
  timings.push([name, Math.round(time * 100) / 100]);
  if (process.env.EXPLAIN_DEBUG) {
    console.log(name, time, JSON.stringify(plans[0]!.Plan, null, 1).slice(0, 20000));
  }
  expect({
    name,
    scanned: seqScans(plans[0]!.Plan).filter((t) => FINANCE_TABLES.includes(t)),
  }).toEqual({
    name,
    scanned: [],
  });
  expect(time, name).toBeLessThan(limitMs);
}

/**
 * One seeding (spec §10: 3 100 clients, 40 admins, 300 000 filled and 5 000 requested entries
 * over five years, 20 000 contracts, 200 rates) serves every check. Retries twice on a busy
 * machine, as the admin home's; a sequential scan fails every attempt anyway.
 */
describe('finance query plans on a seeded volume', () => {
  it(
    'a client’s overview and work log use indexes under 50 ms',
    { timeout: 300_000, retry: 2 },
    async () => {
      await withFinanceVolume(db, async (tx, { groupIds }) => {
        const scope = { kind: 'group', groupId: groupIds[1234]! } as const;
        const thisMonth = financeToday().slice(0, 7) as Month;
        // The overview's default: the last 12 months and the next 12.
        const next12 = { from: monthsBack(thisMonth, 11), to: monthsBack(thisMonth, -12) };
        await expectIndexed(
          tx,
          'overview money (24 months)',
          moneySql(scope, next12, financeToday()),
        );
        await expectIndexed(
          tx,
          'overview hours and cost (24 months)',
          timeTotalsSql(countedEntriesSql(scope, dayBounds(next12)), [
            'adminMonth',
            'month',
            'admin',
            'total',
          ]),
        );
        await expectIndexed(tx, 'overview "all time" bounds', dataMonthRangeSql(scope));

        // The work log: the newest page, an older page, its month totals and the summary.
        await expectIndexed(tx, 'work log page (all time)', workLogEntriesSql(scope, null, null));
        const before = { day: `${monthsBack(thisMonth, 30)}-15`, id: 'z' };
        await expectIndexed(tx, 'work log older page', workLogEntriesSql(scope, null, before));
        await expectIndexed(
          tx,
          'work log page (this year)',
          workLogEntriesSql(scope, { from: `${thisMonth.slice(0, 4)}-01`, to: thisMonth }, null),
        );
        await expectIndexed(
          tx,
          'work log month totals (12 months)',
          timeTotalsSql(
            countedEntriesSql(scope, dayBounds({ from: monthsBack(thisMonth, 11), to: thisMonth })),
            ['adminMonth', 'month'],
          ),
        );
        await expectIndexed(
          tx,
          'work log summary (all time)',
          timeTotalsSql(countedEntriesSql(scope, null), ['admin', 'total']),
        );
        expect(encodeCursor(before)).toBeTruthy();
        console.log('finance EXPLAIN (ms):', JSON.stringify(timings.splice(0)));
      });
    },
  );
});
