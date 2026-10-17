import { sql, type SQL } from 'drizzle-orm';
import {
  Currencies,
  type AdminTime,
  type Currency,
  OVERVIEW_MAX_MONTHS,
  type FinanceOverviewDto,
  type Month,
  type OverviewMoney,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getUserNames } from '../users/service.js';
import { financeToday } from './rates.js';
import { financeItems, financeTimeEntries } from './schema.js';
import {
  monthAfter,
  monthStart,
  monthsOf,
  scopeSql,
  type FinanceScope,
  type MonthRange,
} from './scope.js';

/**
 * Money and hours (Phase 32, spec §3.4, §6.1). Every sum is computed on read from the partial
 * indexes of `finance_time_entries` and `finance_items` (no rollup table). The cost of a set of
 * entries is `round(sum(minutes × rate) / 60)` in EUR minor units, rounded once per shown total,
 * never per entry; an entry without an applicable rate has no cost and counts in
 * `missingRateMinutes`. D calls `overview` and `timeTotalsSql` with a `groups` or `all` scope.
 */

const e = financeTimeEntries;

/**
 * The rate lookup of the time entries of `entries` (a table name or alias in the query): a `left
 * join` that exposes `rate.rate_minor`, the admin's row with the latest `effective_from <=
 * worked_on` ("from the start", null, counting as the earliest). The rates become day ranges
 * once per query (`lead` over each admin's rows, a few hundred rows in all), which the entries
 * join by admin and day: one small read of `finance_rates` per query instead of one lookup per
 * entry, so a system-wide total over 300 000 entries stays one hash join (spec §10).
 */
export function costSql(entries: string): SQL {
  const t = sql.raw(`"${entries.replace(/"/g, '""')}"`);
  return sql`left join (
    select r.user_id, r.rate_minor, coalesce(r.effective_from, '-infinity'::date) as starts,
      lead(r.effective_from) over (partition by r.user_id order by r.effective_from nulls first) as ends
    from finance_rates r
  ) rate on rate.user_id = ${t}.user_id and ${t}.worked_on >= rate.starts
    and (rate.ends is null or ${t}.worked_on < rate.ends)`;
}

/**
 * Filled entries (the only ones that count) of a scope, from a day (inclusive) to one (exclusive).
 * A client scope (`group`, `groups`) is `group_id = …` / `group_id in (…)`, so entries without a
 * client (owner decision 24: time on a ticket with no client, part A2) never reach a client's
 * overview or work log; only `all` (the system-wide page, part D, "Bez klienta") includes them.
 */
export function countedEntriesSql(
  scope: FinanceScope,
  range: { from: string; until: string } | null,
): SQL {
  const bounds = range
    ? sql` and ${e.workedOn} >= ${range.from} and ${e.workedOn} < ${range.until}`
    : sql``;
  return sql`${e.minutes} is not null and ${e.workedOn} is not null and ${scopeSql(e.groupId, scope)}${bounds}`;
}

/** The day bounds of a month range: `from` inclusive, `until` exclusive. */
export function dayBounds(range: MonthRange): { from: string; until: string } {
  return { from: monthStart(range.from), until: monthAfter(range.to) };
}

/** Which totals a `timeTotalsSql` row holds. */
export type TotalsSet = 'adminMonth' | 'month' | 'admin' | 'total';

const SET_SQL: Record<TotalsSet, string> = {
  adminMonth: `(finance_time_entries.user_id, to_char(finance_time_entries.worked_on, 'YYYY-MM'))`,
  month: `(to_char(finance_time_entries.worked_on, 'YYYY-MM'))`,
  admin: `(finance_time_entries.user_id)`,
  total: `()`,
};

/** `grouping(user_id, month)` of each set: a bit is set for a column summed over. */
const GROUPING_OF: Record<number, TotalsSet> = {
  0: 'adminMonth',
  1: 'admin',
  2: 'month',
  3: 'total',
};

/**
 * Hours, tasks, tickets and cost of the counted entries matching `where`, in one pass, for each
 * requested grouping set. A task done by two admins is one task in a month's or a period's total
 * (and one for each admin); a deleted task counts by its entry. Tickets count by their own
 * entries: a ticket and its linked tasks are separate rows, so nothing is counted twice.
 */
export function timeTotalsSql(where: SQL, sets: readonly TotalsSet[]): SQL {
  const month = sql`to_char(${e.workedOn}, 'YYYY-MM')`;
  // A column no set groups by may not be selected nor passed to grouping(): it is null there.
  const byUser = sets.includes('adminMonth') || sets.includes('admin');
  const byMonth = sets.includes('adminMonth') || sets.includes('month');
  return sql`
    select ${byUser ? e.userId : sql`null::text`} as user_id,
      ${byMonth ? month : sql`null::text`} as month,
      (${byUser ? sql`grouping(${e.userId})` : sql`1`} * 2
        + ${byMonth ? sql`grouping(${month})` : sql`1`})::int as grp,
      sum(${e.minutes})::int as minutes,
      count(distinct coalesce(${e.taskId}, ${e.id})) filter (where ${e.source} = 'task')::int as task_count,
      count(distinct coalesce(${e.ticketId}, ${e.id})) filter (where ${e.source} = 'ticket')::int as ticket_count,
      round(sum(${e.minutes}::bigint * rate.rate_minor) / 60.0)::bigint as cost,
      coalesce(sum(${e.minutes}) filter (where rate.rate_minor is null), 0)::int as missing
    from ${e} ${costSql('finance_time_entries')}
    where ${where}
    group by grouping sets (${sql.raw(sets.map((s) => SET_SQL[s]).join(', '))})
  `;
}

export type TotalsRow = {
  set: TotalsSet;
  userId: string | null;
  month: Month | null;
  minutes: number;
  taskCount: number;
  ticketCount: number;
  cost: number | null;
  missingRateMinutes: number;
};

type RawTotals = {
  user_id: string | null;
  month: string | null;
  grp: number;
  minutes: number;
  task_count: number;
  ticket_count: number;
  cost: string | number | null;
  missing: number;
};

/** Runs `timeTotalsSql` and types its rows. */
export async function timeTotals(
  db: Db,
  where: SQL,
  sets: readonly TotalsSet[],
): Promise<TotalsRow[]> {
  const rows = await db.execute<RawTotals>(timeTotalsSql(where, sets));
  return [...rows].map((r) => ({
    set: GROUPING_OF[r.grp]!,
    userId: r.user_id,
    month: r.month,
    minutes: r.minutes,
    taskCount: r.task_count,
    ticketCount: r.ticket_count,
    cost: r.cost === null ? null : Number(r.cost),
    missingRateMinutes: r.missing,
  }));
}

/** One admin's line of a totals set. */
export function adminTime(row: TotalsRow, names: Map<string, string>): AdminTime {
  return {
    userId: row.userId!,
    name: names.get(row.userId!) ?? '',
    minutes: row.minutes,
    taskCount: row.taskCount,
    ticketCount: row.ticketCount,
    cost: row.cost,
    missingRateMinutes: row.missingRateMinutes,
  };
}

/** Most minutes first, then by name. */
export function byMinutes(a: AdminTime, b: AdminTime): number {
  return b.minutes - a.minutes || a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId);
}

/**
 * The contracts' money of a scope by currency and start month: paid when the start date is today
 * (Bratislava) or earlier, to be paid when later (owner decision 12). Reads
 * `finance_items_contract_starts_idx`.
 */
export function moneySql(scope: FinanceScope, range: MonthRange, today: string): SQL {
  const i = financeItems;
  const { from, until } = dayBounds(range);
  return sql`
    select ${i.currency} as currency, to_char(${i.startsOn}, 'YYYY-MM') as month,
      coalesce(sum(${i.amountMinor}) filter (where ${i.startsOn} <= ${today}), 0)::bigint as paid,
      coalesce(sum(${i.amountMinor}) filter (where ${i.startsOn} > ${today}), 0)::bigint as to_be_paid
    from ${i}
    where ${i.type} = 'contract' and ${i.startsOn} >= ${from} and ${i.startsOn} < ${until}
      and ${scopeSql(i.groupId, scope)}
    group by 1, 2
    order by 2
  `;
}

/**
 * `GET /api/groups/:id/finance/overview` (and D's system-wide one): money by currency and month,
 * the cost by month, hours by admin and month, totals and the minutes without a rate. Three
 * queries: money, the time totals (four grouping sets in one pass), the admins' names.
 */
export async function overview(
  db: Db,
  scope: FinanceScope,
  range: MonthRange,
  now: Date = new Date(),
): Promise<FinanceOverviewDto> {
  const moneyRows = await db.execute<{
    currency: Currency;
    month: Month;
    paid: string | number;
    to_be_paid: string | number;
  }>(moneySql(scope, range, financeToday(now)));
  const byCurrency = new Map<Currency, OverviewMoney>();
  for (const row of moneyRows) {
    const money = byCurrency.get(row.currency) ?? {
      currency: row.currency,
      paid: 0,
      toBePaid: 0,
      byMonth: [],
    };
    const paid = Number(row.paid);
    const toBePaid = Number(row.to_be_paid);
    money.paid += paid;
    money.toBePaid += toBePaid;
    money.byMonth.push({ month: row.month, paid, toBePaid });
    byCurrency.set(row.currency, money);
  }
  const money = Currencies.flatMap((c) => byCurrency.get(c) ?? []);

  const rows = await timeTotals(db, countedEntriesSql(scope, dayBounds(range)), [
    'adminMonth',
    'month',
    'admin',
    'total',
  ]);
  const names = await getUserNames(
    db,
    rows.flatMap((r) => (r.userId ? [r.userId] : [])),
  );
  const total = rows.find((r) => r.set === 'total');
  const months = rows
    .filter((r) => r.set === 'month')
    .sort((a, b) => a.month!.localeCompare(b.month!));
  const byAdmin = rows
    .filter((r) => r.set === 'admin')
    .map((r) => ({
      ...adminTime(r, names),
      byMonth: rows
        .filter((m) => m.set === 'adminMonth' && m.userId === r.userId)
        .sort((a, b) => a.month!.localeCompare(b.month!))
        .map((m) => ({ month: m.month!, minutes: m.minutes })),
    }))
    .sort(byMinutes);

  return {
    from: range.from,
    to: range.to,
    months: monthsOf(range),
    money,
    cost: {
      total: total?.cost ?? 0,
      byMonth: months.flatMap((m) =>
        m.cost === null ? [] : [{ month: m.month!, amount: m.cost }],
      ),
    },
    hours: {
      minutes: total?.minutes ?? 0,
      taskCount: total?.taskCount ?? 0,
      ticketCount: total?.ticketCount ?? 0,
      missingRateMinutes: total?.missingRateMinutes ?? 0,
      byAdmin,
    },
  };
}

/** The first and last day with a contract start or counted time of a scope. */
export function dataMonthRangeSql(scope: FinanceScope): SQL {
  const i = financeItems;
  const contracts = sql`${i.type} = 'contract' and ${scopeSql(i.groupId, scope)}`;
  return sql`
    select least(
        (select min(${i.startsOn}) from ${i} where ${contracts}),
        (select min(${e.workedOn}) from ${e} where ${countedEntriesSql(scope, null)})
      )::text as first,
      greatest(
        (select max(${i.startsOn}) from ${i} where ${contracts}),
        (select max(${e.workedOn}) from ${e} where ${countedEntriesSql(scope, null)})
      )::text as last
  `;
}

/**
 * "All time" of the overview: from the first month with a contract start or counted time of the
 * scope to the last (at least the current month), capped at `OVERVIEW_MAX_MONTHS` back from the
 * end. Two index reads (min and max of each indexed column).
 */
export async function dataMonthRange(
  db: Db,
  scope: FinanceScope,
  now: Date = new Date(),
): Promise<MonthRange> {
  const [row] = await db.execute<{ first: string | null; last: string | null }>(
    dataMonthRangeSql(scope),
  );
  const thisMonth = financeToday(now).slice(0, 7);
  const first = row?.first?.slice(0, 7) ?? thisMonth;
  const lastData = row?.last?.slice(0, 7) ?? thisMonth;
  const to = lastData > thisMonth ? lastData : thisMonth;
  const earliest = monthsBack(to, OVERVIEW_MAX_MONTHS - 1);
  return { from: first < earliest ? earliest : first < to ? first : to, to };
}

/** `2026-10` minus 3 months is `2026-07`. */
export function monthsBack(month: Month, count: number): Month {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const index = y * 12 + (m - 1) - count;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
}
