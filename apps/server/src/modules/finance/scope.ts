import { eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Month } from '@spolu/shared';

/**
 * Which clients a finance query covers (Phase 32): one client's tab (`group`), the system-wide
 * page's client filter (`groups`) or every client (`all`). Parts B, C and D take it, so one
 * function serves the tab and `/finance`.
 */
export type FinanceScope =
  { kind: 'group'; groupId: string } | { kind: 'groups'; groupIds: string[] } | { kind: 'all' };

/** An inclusive range of Bratislava months, `YYYY-MM`. */
export type MonthRange = { from: Month; to: Month };

/** The `where` condition of a scope on a `group_id` column; an empty `groups` matches nothing. */
export function scopeSql(column: AnyPgColumn, scope: FinanceScope): SQL {
  switch (scope.kind) {
    case 'group':
      return eq(column, scope.groupId);
    case 'groups':
      return scope.groupIds.length > 0 ? inArray(column, scope.groupIds) : sql`false`;
    case 'all':
      return sql`true`;
  }
}

/** The scope of `/finance`'s `clients=` filter: none named means every client. */
export function scopeOfClients(groupIds: readonly string[]): FinanceScope {
  return groupIds.length > 0 ? { kind: 'groups', groupIds: [...groupIds] } : { kind: 'all' };
}

/** `2026-10` -> `2026-10-01`: the first day of a month (a `date` bound, inclusive). */
export function monthStart(month: Month): string {
  return `${month}-01`;
}

/** `2026-12` -> `2027-01-01`: the day after a month (a `date` bound, exclusive). */
export function monthAfter(month: Month): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
}

/** Every month of the range, in order: `2026-11`, `2026-12`, `2027-01`. */
export function monthsOf(range: MonthRange): Month[] {
  const months: Month[] = [];
  let [y, m] = range.from.split('-').map(Number) as [number, number];
  for (;;) {
    const month = `${y}-${String(m).padStart(2, '0')}`;
    if (month > range.to) return months;
    months.push(month);
    m += 1;
    if (m === 13) [y, m] = [y + 1, 1];
  }
}
