import { sql, type SQL } from 'drizzle-orm';
import {
  RANKING_PAGE_SIZE,
  type Currency,
  type HoursRankingPage,
  type HoursRankingRow,
  type PaidRankingPage,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getGroupLabels, type GroupLabel } from '../groups/service.js';
import { costSql, countedEntriesSql, dayBounds } from './aggregates.js';
import { financeToday } from './rates.js';
import { financeItems, financeTimeEntries } from './schema.js';
import { scopeSql, type FinanceScope, type MonthRange } from './scope.js';

/**
 * The rankings of the system-wide page (Phase 32 part D, spec §6.2): clients by money paid in a
 * year or month (one currency at a time, owner decision 11) and by hours or the cost of those
 * hours in a period (optionally one admin's). Each is one query: the per-client sums, ranked with
 * `rank()` (equal values share a rank), paged 20 at a time by a keyset on `(value desc, client)`;
 * the clients' names come in one batch from the groups module. Time without a client (owner
 * decision 24) is one more row, `groupId` null, and only an `all` scope reaches it.
 */

/** The `after` cursor is malformed (400 `invalid_filter`). */
export class RankingCursorError extends Error {
  constructor() {
    super('Bad ranking cursor');
    this.name = 'RankingCursorError';
  }
}

type Cursor = { value: string; key: string };

export function encodeRankingCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify([cursor.value, cursor.key])).toString('base64url');
}

export function decodeRankingCursor(text: string): Cursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(text, 'base64url').toString('utf8'));
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      /^-?\d{1,19}$/.test(value[0]) &&
      typeof value[1] === 'string' &&
      value[1].length <= 100
    ) {
      return { value: value[0], key: value[1] };
    }
  } catch {
    // falls through
  }
  throw new RankingCursorError();
}

/** Ranks `per` (rows of `key`, `value` and more), then cuts the page after `after`. */
function rankedPage(per: SQL, after: Cursor | null, limit: number): SQL {
  const keyset = after
    ? sql`where value < ${after.value}::bigint or (value = ${after.value}::bigint and key > ${after.key})`
    : sql``;
  return sql`
    with per as (${per}),
    ranked as (
      select per.*, rank() over (order by value desc)::int as rank,
        sum(value) over ()::bigint as total, max(value) over ()::bigint as max
      from per
    )
    select * from ranked ${keyset}
    order by value desc, key asc
    limit ${limit}`;
}

export type PaidRankingFilter = {
  /** The page period's months; null: all time (every contract started up to today). */
  range: MonthRange | null;
  currency: Currency;
  after?: string;
};

/** The year's (or month's) months (the route's older `year=&month=` form). */
export function paidRange(filter: { year: number; month?: number }): MonthRange {
  const y = String(filter.year);
  if (filter.month === undefined) return { from: `${y}-01`, to: `${y}-12` };
  const month = `${y}-${String(filter.month).padStart(2, '0')}`;
  return { from: month, to: month };
}

/**
 * The paid ranking's query: per client, the amounts of its contracts in `currency` that start in
 * the period (any time without one) and no later than today (owner decision 12: a contract is paid on its start date).
 * Reads `finance_items_contract_starts_idx` (`starts_on, group_id`, contracts only).
 */
export function paidRankingSql(
  scope: FinanceScope,
  filter: PaidRankingFilter,
  today: string,
  limit: number = RANKING_PAGE_SIZE + 1,
): SQL {
  const i = financeItems;
  const bounds = filter.range ? dayBounds(filter.range) : null;
  const period = bounds
    ? sql` and ${i.startsOn} >= ${bounds.from} and ${i.startsOn} < ${bounds.until}`
    : sql``;
  const after = filter.after ? decodeRankingCursor(filter.after) : null;
  const per = sql`
    select ${i.groupId} as key, ${i.groupId} as group_id, sum(${i.amountMinor})::bigint as value
    from ${i}
    where ${i.type} = 'contract' and ${i.currency} = ${filter.currency}${period}
      and ${i.startsOn} <= ${today}
      and ${scopeSql(i.groupId, scope)}
    group by ${i.groupId}`;
  return rankedPage(per, after, limit);
}

type RankedRow = {
  key: string;
  group_id: string | null;
  value: string | number;
  rank: number;
  total: string | number;
  max: string | number;
};

const NO_GROUP: GroupLabel = { name: '', hasLogo: false, updatedAt: '' };

/** `GET /api/finance/rankings/paid`: one page of 20. */
export async function paidRanking(
  db: Db,
  scope: FinanceScope,
  filter: PaidRankingFilter,
  now: Date = new Date(),
): Promise<PaidRankingPage> {
  if (scope.kind === 'groups' && scope.groupIds.length === 0) {
    return { rows: [], total: 0, max: 0, nextCursor: null };
  }
  const fetched = [
    ...(await db.execute<RankedRow>(paidRankingSql(scope, filter, financeToday(now)))),
  ];
  const rows = fetched.slice(0, RANKING_PAGE_SIZE);
  const labels = await getGroupLabels(
    db,
    rows.map((r) => r.group_id!),
  );
  const last = rows.at(-1);
  return {
    rows: rows.map((r) => {
      const label = labels.get(r.group_id!) ?? NO_GROUP;
      return {
        rank: r.rank,
        groupId: r.group_id!,
        groupName: label.name,
        hasLogo: label.hasLogo,
        groupUpdatedAt: label.updatedAt,
        amountMinor: Number(r.value),
      };
    }),
    total: rows[0] ? Number(rows[0].total) : 0,
    max: rows[0] ? Number(rows[0].max) : 0,
    nextCursor:
      fetched.length > RANKING_PAGE_SIZE && last
        ? encodeRankingCursor({ value: String(last.value), key: last.key })
        : null,
  };
}

export type HoursRankingFilter = {
  /** null: all time. */
  range: MonthRange | null;
  /** One admin's hours only. */
  admin?: string;
  sort: 'hours' | 'cost';
  after?: string;
};

/**
 * The hours ranking's query: per client (and the time without one, for `all`), the counted
 * minutes of the period, their cost (rates as everywhere, `costSql`) and the minutes without a
 * rate. Ranked by minutes or by cost (a client none of whose minutes has a rate counts 0).
 * Reads `finance_time_entries_day_group_idx`, or `…_user_day_idx` with an admin.
 */
export function hoursRankingSql(
  scope: FinanceScope,
  filter: HoursRankingFilter,
  limit: number = RANKING_PAGE_SIZE + 1,
): SQL {
  const e = financeTimeEntries;
  const after = filter.after ? decodeRankingCursor(filter.after) : null;
  const admin = filter.admin ? sql` and ${e.userId} = ${filter.admin}` : sql``;
  const cost = sql`round(sum(${e.minutes}::bigint * rate.rate_minor) / 60.0)::bigint`;
  const value = filter.sort === 'cost' ? sql`coalesce(${cost}, 0)` : sql`sum(${e.minutes})::bigint`;
  const per = sql`
    select coalesce(${e.groupId}, '') as key, ${e.groupId} as group_id, ${value} as value,
      sum(${e.minutes})::int as minutes, ${cost} as cost,
      coalesce(sum(${e.minutes}) filter (where rate.rate_minor is null), 0)::int as missing
    from ${e} ${costSql('finance_time_entries')}
    where ${countedEntriesSql(scope, filter.range ? dayBounds(filter.range) : null)}${admin}
    group by ${e.groupId}
    having sum(${e.minutes}) > 0`;
  return rankedPage(per, after, limit);
}

/** `GET /api/finance/rankings/hours`: one page of 20. */
export async function hoursRanking(
  db: Db,
  scope: FinanceScope,
  filter: HoursRankingFilter,
): Promise<HoursRankingPage> {
  if (scope.kind === 'groups' && scope.groupIds.length === 0) {
    return { rows: [], max: 0, nextCursor: null };
  }
  const fetched = [
    ...(await db.execute<
      RankedRow & { minutes: number; cost: string | number | null; missing: number }
    >(hoursRankingSql(scope, filter))),
  ];
  const rows = fetched.slice(0, RANKING_PAGE_SIZE);
  const labels = await getGroupLabels(
    db,
    rows.flatMap((r) => (r.group_id ? [r.group_id] : [])),
  );
  const last = rows.at(-1);
  return {
    rows: rows.map((r): HoursRankingRow => {
      const label = (r.group_id && labels.get(r.group_id)) || NO_GROUP;
      return {
        rank: r.rank,
        groupId: r.group_id,
        groupName: label.name,
        hasLogo: label.hasLogo,
        groupUpdatedAt: label.updatedAt,
        minutes: r.minutes,
        cost: r.cost === null ? null : Number(r.cost),
        missingRateMinutes: r.missing,
      };
    }),
    max: rows[0] ? Number(rows[0].max) : 0,
    nextCursor:
      fetched.length > RANKING_PAGE_SIZE && last
        ? encodeRankingCursor({ value: String(last.value), key: last.key })
        : null,
  };
}
