import { afterAll, describe, expect, inject, it } from 'vitest';
import { sql, type SQL } from 'drizzle-orm';
import type { Month } from '@spolu/shared';
import { createDb, type Db } from '../../infra/db/client.js';
import {
  countedEntriesSql,
  dataMonthRangeSql,
  dayBounds,
  expensesSql,
  moneySql,
  monthsBack,
  timeTotalsSql,
} from './aggregates.js';
import { contractsPageSql } from './documents.js';
import { hoursRankingSql, paidRankingSql } from './rankings.js';
import { salaryPageSql, salaryTotalsSql } from './salaries.js';
import { financeToday } from './rates.js';
import { financeVolumeIds } from './test-volume.js';
import { encodeCursor, topClientsSql, workLogEntriesSql } from './work-log.js';

// This run's clone of the finance volume's template (test/setup-explain-db.ts, ADR 0040).
const { db, close } = createDb(inject('explainDatabaseUrls').finance);
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
 * `finance_contract_shares` (Phase 32 E: a few shares per contract of several clients, 6 000
 * here) is small too: for every client or a list of 40 the planner reads it whole, which is the
 * plan; one client's queries must use its index, so those checks name it (`alsoChecked`).
 */
const FINANCE_TABLES = ['finance_time_entries', 'finance_items'];
const SHARES = ['finance_contract_shares'];

/**
 * The bound of an aggregate over every client's time of a long range (two fifths of the volume,
 * or all of it): spec §10 hoped for 300 ms; on this volume (five years at full team load) it
 * measures 0.3–0.6 s, so it gets its own bound, and the monthly rollup of spec §10 is the remedy
 * once real data comes near the volume (`architecture/performance.md`).
 */
const WHOLE_RANGE_MS = 1000;

/** The measured times, printed at the end for `architecture/performance.md`. */
const timings: [string, number][] = [];

/**
 * Runs `query` under `explain (analyze, format json)`: no finance table read with a sequential
 * scan, always checked. The `limitMs` bound (spec §10: a client's overview and work-log page under
 * 50 ms) is wall time, so it runs only with `RUN_BENCH=1`, as in `home/explain.test.ts`. Warm
 * once, best of three. `EXPLAIN_DEBUG=1` prints the plan.
 */
async function expectIndexed(
  tx: Db,
  name: string,
  query: SQL,
  limitMs = 50,
  /** Tables a whole-range aggregate may read sequentially (see the system-wide test). */
  wholeTable: readonly string[] = [],
  /** Small tables this query must still read by index (one client's shares). */
  alsoChecked: readonly string[] = [],
): Promise<void> {
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
    scanned: seqScans(plans[0]!.Plan).filter(
      (t) => (FINANCE_TABLES.includes(t) || alsoChecked.includes(t)) && !wholeTable.includes(t),
    ),
  }).toEqual({
    name,
    scanned: [],
  });
  if (process.env.RUN_BENCH) expect(time, name).toBeLessThan(limitMs);
}

/**
 * One seeding (spec §10: 3 100 clients, 40 admins, 300 000 filled and 5 000 requested entries
 * over five years, 20 000 contracts, 200 rates), in the template this run cloned, serves every
 * check: the three tests read the same clone, which has no dead tuples (ADR 0040). The plan checks
 * do not depend on timing, so there is no retry; the 50 ms bounds run only with `RUN_BENCH=1`.
 */
describe('finance query plans on a seeded volume', () => {
  const tx: Db = db;
  const ids = financeVolumeIds();

  it(
    'a client’s overview and work log use indexes (under 50 ms with RUN_BENCH=1)',
    { timeout: 300_000 },
    async () => {
      const { groupIds } = ids;
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

      // Phase 33 P6: the Project and Event filters (the volume's ids: `-p<n>-<k>`, `-v<n>-<k>`).
      const groupId = groupIds[1234]!;
      const projectId = `${groupId.replace(/-g(\d+)$/, '-p$1')}-1`;
      const eventId = `${groupId.replace(/-g(\d+)$/, '-v$1')}-1`;
      const byProject = { project: projectId };
      const byEvent = { project: projectId, event: eventId };
      await expectIndexed(
        tx,
        'overview money by project (24 months)',
        moneySql(scope, next12, financeToday(), byProject),
      );
      await expectIndexed(
        tx,
        'overview hours and cost by project (24 months)',
        timeTotalsSql(countedEntriesSql(scope, dayBounds(next12), byProject), [
          'adminMonth',
          'month',
          'admin',
          'total',
        ]),
      );
      await expectIndexed(
        tx,
        'overview hours and cost by event (24 months)',
        timeTotalsSql(countedEntriesSql(scope, dayBounds(next12), byEvent), ['total']),
      );
      await expectIndexed(
        tx,
        'work log page by project (all time)',
        workLogEntriesSql(scope, null, null, undefined, byProject),
      );
      await expectIndexed(
        tx,
        'work log page by event (all time)',
        workLogEntriesSql(scope, null, null, undefined, byEvent),
      );
      await expectIndexed(
        tx,
        'work log page without a project (all time)',
        workLogEntriesSql(scope, null, null, undefined, { project: 'none' }),
      );
      await expectIndexed(
        tx,
        'work log summary by project (all time)',
        timeTotalsSql(countedEntriesSql(scope, null, byProject), ['admin', 'total']),
      );
      // 2026-10-18 (migration 0049): every entry of a project, open requests too, as the
      // project foreign key's cascade and a project merge read them.
      await expectIndexed(
        tx,
        'every entry of a project',
        sql`select id from finance_time_entries
          where group_id = ${groupId} and project_id = ${projectId}`,
      );
      console.log('finance EXPLAIN (ms):', JSON.stringify(timings.splice(0)));
    },
  );

  it(
    'the system-wide overview, work log, contracts and rankings use indexes (under 300 ms with RUN_BENCH=1)',
    { timeout: 300_000 },
    async () => {
      const { groupIds, adminIds } = ids;
      // "Every client" includes the admin group by default (Phase 34 part E, owner decision of
      // 2026-10-18); unticked, it leaves it out: `allButTeam`, a client standing in for it.
      const all = { kind: 'all' } as const;
      const allButTeam = { kind: 'all', except: groupIds[0]! } as const;
      const chosen = { kind: 'groups', groupIds: groupIds.slice(100, 140) } as const;
      const thisMonth = financeToday().slice(0, 7) as Month;
      const year = Number(thisMonth.slice(0, 4));
      const thisYear = { from: `${year}-01`, to: `${year}-12` };
      const next12 = { from: monthsBack(thisMonth, 11), to: monthsBack(thisMonth, -12) };
      const wide = (name: string, query: SQL, wholeTable: readonly string[] = [], limitMs = 300) =>
        expectIndexed(tx, name, query, limitMs, wholeTable);

      // Every client's contracts of 24 months are a large share of `finance_items`: a
      // sequential read of it is the right plan (5 ms here); so is the amount sort over all.
      await wide('all clients: overview money (24 months)', moneySql(all, next12, financeToday()), [
        'finance_items',
      ]);
      await wide(
        '40 clients: overview money (24 months)',
        moneySql(chosen, next12, financeToday()),
      );
      // Every client's time of 24 months is two fifths of the table: the planner may read it
      // sequentially, which is the right plan; the bound (RUN_BENCH) is what guards it.
      await wide(
        'all clients: overview hours and cost (24 months)',
        timeTotalsSql(countedEntriesSql(all, dayBounds(next12)), [
          'adminMonth',
          'month',
          'admin',
          'total',
        ]),
        ['finance_time_entries'],
        WHOLE_RANGE_MS,
      );
      await wide('all clients: overview "all time" bounds', dataMonthRangeSql(all));
      await wide(
        'all clients: work log summary (all time)',
        timeTotalsSql(countedEntriesSql(all, null), ['admin', 'total']),
        ['finance_time_entries'],
        WHOLE_RANGE_MS,
      );
      await wide(
        '40 clients: overview hours and cost (24 months)',
        timeTotalsSql(countedEntriesSql(chosen, dayBounds(next12)), [
          'adminMonth',
          'month',
          'admin',
          'total',
        ]),
      );
      await wide('all clients: work log page', workLogEntriesSql(all, null, null));
      await wide(
        'all clients but the team: work log page',
        workLogEntriesSql(allButTeam, null, null),
      );
      await wide(
        'all clients but the team: overview money (24 months)',
        moneySql(allButTeam, next12, financeToday()),
        ['finance_items'],
      );
      await wide(
        'all clients but the team: work log summary (all time)',
        timeTotalsSql(countedEntriesSql(allButTeam, null), ['admin', 'total']),
        ['finance_time_entries'],
        WHOLE_RANGE_MS,
      );
      await wide('40 clients: work log page', workLogEntriesSql(chosen, null, null));
      await wide(
        'all clients: work log top clients (2 months)',
        topClientsSql(all, { from: monthsBack(thisMonth, 1), to: thisMonth }),
      );
      await wide(
        'all clients: work log month totals (2 months)',
        timeTotalsSql(
          countedEntriesSql(all, dayBounds({ from: monthsBack(thisMonth, 1), to: thisMonth })),
          ['adminMonth', 'month'],
        ),
      );

      const today = financeToday();
      await wide(
        'paid ranking (this year, all clients)',
        paidRankingSql(all, { range: thisYear, currency: 'EUR' }, today),
      );
      await wide(
        'paid ranking (one month, 40 clients)',
        paidRankingSql(
          chosen,
          { range: { from: `${year}-01`, to: `${year}-01` }, currency: 'EUR' },
          today,
        ),
      );
      // The page period "all time" (follow-up of part D): every contract started up to today
      // is most of `finance_items`, every counted entry all of `finance_time_entries`; reading
      // them whole is the plan, as for the work log summary (the bound guards it).
      await wide(
        'paid ranking (all time, all clients)',
        paidRankingSql(all, { range: null, currency: 'EUR' }, today),
        ['finance_items'],
      );
      await wide(
        'paid ranking (all time, 40 clients)',
        paidRankingSql(chosen, { range: null, currency: 'EUR' }, today),
      );
      await wide(
        'hours ranking (all time, all clients)',
        hoursRankingSql(all, { range: null, sort: 'hours' }),
        ['finance_time_entries'],
        WHOLE_RANGE_MS,
      );
      await wide(
        'hours ranking (all time, 40 clients)',
        hoursRankingSql(chosen, { range: null, sort: 'hours' }),
      );
      await wide(
        'hours ranking (this year, all clients)',
        hoursRankingSql(all, { range: thisYear, sort: 'hours' }),
      );
      await wide(
        'hours ranking by cost (this year, one admin)',
        hoursRankingSql(all, { range: thisYear, admin: adminIds[3]!, sort: 'cost' }),
      );

      await wide(
        'contracts by start (all clients)',
        contractsPageSql(all, { type: 'contract', sort: 'start' }),
      );
      await wide(
        'contracts by end, soonest first (all clients)',
        contractsPageSql(all, { type: 'contract', sort: 'end', dir: 'asc' }),
      );
      await wide(
        'contracts by start, this year (all clients)',
        contractsPageSql(all, { type: 'contract', sort: 'start', period: thisYear }),
      );
      await wide(
        'contracts by end, this year (40 clients)',
        contractsPageSql(chosen, { type: 'contract', sort: 'end', dir: 'asc', period: thisYear }),
      );
      await wide(
        'contracts by amount (all clients)',
        contractsPageSql(all, { type: 'contract', sort: 'amount' }),
        ['finance_items'],
      );
      await wide(
        'contracts by amount (40 clients)',
        contractsPageSql(chosen, { type: 'contract', sort: 'amount' }),
      );
      await wide('finance search (all clients)', contractsPageSql(all, { q: 'contract 1234' }));
      console.log('finance EXPLAIN system-wide (ms):', JSON.stringify(timings.splice(0)));
    },
  );

  it(
    'the organisation level (Phase 32 E): shared contracts, expenses and the organisation’s items use indexes',
    { timeout: 300_000 },
    async () => {
      const { groupIds } = ids;
      const all = { kind: 'all' } as const;
      const org = { kind: 'org' } as const;
      // Client 1235 has shares of contracts of several clients (its index - 1 is 1234).
      const client = { kind: 'group', groupId: groupIds[1234]! } as const;
      const chosen = { kind: 'groups', groupIds: groupIds.slice(100, 140) } as const;
      const thisMonth = financeToday().slice(0, 7) as Month;
      const year = Number(thisMonth.slice(0, 4));
      const thisYear = { from: `${year}-01`, to: `${year}-12` };
      const next12 = { from: monthsBack(thisMonth, 11), to: monthsBack(thisMonth, -12) };
      const today = financeToday();
      const check = (name: string, query: SQL, wholeTable: readonly string[] = [], ms = 50) =>
        expectIndexed(tx, name, query, ms, wholeTable);
      /** One client's queries read its shares by index too. */
      const checkClient = (name: string, query: SQL) =>
        expectIndexed(tx, name, query, 50, [], SHARES);

      // A client's Documents card with its shared contracts (top level, flat, a search).
      await checkClient(
        'client: documents top level with shares',
        contractsPageSql(client, { folderId: null }),
      );
      await checkClient(
        'client: contracts flat with shares',
        contractsPageSql(client, { type: 'contract' }),
      );
      await checkClient(
        'client: documents search with shares',
        contractsPageSql(client, { q: 'shared' }),
      );
      // A client's money and "all time" bounds with its shares.
      await checkClient('client: overview money with shares', moneySql(client, next12, today));
      await checkClient('client: "all time" bounds with shares', dataMonthRangeSql(client));

      // The organisation's card: its top level and a type filter.
      await check('organisation: documents top level', contractsPageSql(org, { folderId: null }));
      await check('organisation: expenses flat', contractsPageSql(org, { type: 'expense' }));

      // The ledger: expenses of the period, by date and soonest first; chosen clients' shared
      // contracts; every kind (no index orders every kind by start: a top-N of the table).
      await check(
        'ledger: expenses by date, this year',
        contractsPageSql(all, { type: 'expense', sort: 'start', period: thisYear }),
        [],
        300,
      );
      await check(
        'ledger: expenses by date, soonest first',
        contractsPageSql(all, { type: 'expense', sort: 'end', dir: 'asc' }),
        [],
        300,
      );
      await check(
        'ledger: contracts of 40 clients with shares',
        contractsPageSql(chosen, { type: 'contract', sort: 'start' }),
        [],
        300,
      );
      await check(
        'ledger: every kind by start',
        contractsPageSql(all, { sort: 'start' }),
        ['finance_items'],
        300,
      );

      // Money out and the overview of every client: the whole (small) shares table is the plan
      // for every client's money, as `finance_items` is for its contracts.
      await check('organisation: expenses (24 months)', expensesSql(next12, today), [], 300);
      // Salaries (2026-10-21): one row per admin and month (2 880 here, 40 admins over six years)
      // is a small table like the rates: the planner reads it whole when that is cheaper, which
      // is the plan, so it is timed here (the bound with RUN_BENCH=1) but not held to an index.
      const salaries = (name: string, query: SQL, ms = 50) => expectIndexed(tx, name, query, ms);
      const admin = ids.adminIds[3]!;
      await salaries('salaries: first page', salaryPageSql({}, 51));
      await salaries('salaries: one admin', salaryPageSql({ admin }, 51));
      await salaries('salaries: this year', salaryPageSql({ range: thisYear }, 51));
      await salaries(
        'salaries: one admin, this year',
        salaryPageSql({ admin, range: thisYear }, 51),
      );
      await salaries('salaries: totals of this year', salaryTotalsSql({ range: thisYear }));
      await salaries('salaries: totals of one admin', salaryTotalsSql({ admin }));
      await salaries('salaries in the money out (24 months)', expensesSql(next12, today), 300);
      await check(
        'organisation: "all time" bounds with expenses',
        dataMonthRangeSql(all, true),
        [],
        300,
      );
      await check(
        '40 clients: overview money with shares',
        moneySql(chosen, next12, today),
        [],
        300,
      );
      await check(
        'paid ranking with shares (this year, 40 clients)',
        paidRankingSql(chosen, { range: thisYear, currency: 'EUR' }, today),
        [],
        300,
      );
      console.log('finance EXPLAIN organisation (ms):', JSON.stringify(timings.splice(0)));
    },
  );
});
