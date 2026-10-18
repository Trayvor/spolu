import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Month } from '@spolu/shared';

/**
 * Which clients a finance query covers (Phase 32): one client's tab (`group`), the system-wide
 * page's client filter (`groups`) or every client (`all`). Parts B, C and D take it, so one
 * function serves the tab and `/finance`. `org` (Phase 32 E): the rows of no client, the
 * organisation's own items on `/finance` (`group_id is null`). `all` with `except` (Phase 34
 * part E): every client but that group, the admin group "eGrant tím", when `/finance`'s option
 * for it is unticked (it is in by default, owner decision of 2026-10-18); the rows without a
 * client stay in.
 */
export type FinanceScope =
  | { kind: 'group'; groupId: string }
  | { kind: 'groups'; groupIds: string[] }
  | { kind: 'all'; except?: string }
  | { kind: 'org' };

/** An inclusive range of Bratislava months, `YYYY-MM`. */
export type MonthRange = { from: Month; to: Month };

/**
 * The `where` condition of a scope on a `group_id` column (or a column of an alias, as SQL); an
 * empty `groups` matches nothing.
 */
export function scopeSql(column: AnyPgColumn | SQL, scope: FinanceScope): SQL {
  switch (scope.kind) {
    case 'group':
      return sql`${column} = ${scope.groupId}`;
    case 'groups':
      return scope.groupIds.length > 0
        ? sql`${column} in (${sql.join(
            scope.groupIds.map((id) => sql`${id}`),
            sql`, `,
          )})`
        : sql`false`;
    case 'all':
      return scope.except ? sql`(${column} is null or ${column} <> ${scope.except})` : sql`true`;
    case 'org':
      return sql`${column} is null`;
  }
}

/**
 * The scope of `/finance`'s `clients=` filter: none named means every client, the admin group
 * "eGrant tím" included (Phase 34 part E, owner decision of 2026-10-18: the team's spending
 * counts) unless `internal` is false (the option unticked, `internal=0`). Named clients are
 * exactly those: the admin group only when `clients=` names it.
 */
export function scopeOfClients(
  groupIds: readonly string[],
  adminGroup: { id: string | null; internal: boolean } = { id: null, internal: true },
): FinanceScope {
  const { id, internal } = adminGroup;
  if (groupIds.length === 0) {
    return id && !internal ? { kind: 'all', except: id } : { kind: 'all' };
  }
  return { kind: 'groups', groupIds: [...groupIds] };
}

/**
 * The rankings' scope (Phase 34 part E): the admin group is never ranked, whatever the filter
 * chose, because the rankings compare clients.
 */
export function withoutGroup(scope: FinanceScope, groupId: string | null): FinanceScope {
  if (!groupId) return scope;
  switch (scope.kind) {
    case 'all':
      return { kind: 'all', except: groupId };
    case 'groups':
      return { kind: 'groups', groupIds: scope.groupIds.filter((id) => id !== groupId) };
    default:
      return scope;
  }
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
