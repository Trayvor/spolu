import { inArray, sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { countedEntriesSql } from './aggregates.js';
import { financeTimeEntries } from './schema.js';

/**
 * Filled minutes per user with `worked_on` in [from, until): one grouped read on
 * `finance_time_entries_user_day_idx`, the work log's counted entries (`countedEntriesSql`, scope
 * `all`, so time without a client counts too). A user without entries has no key.
 *
 * Called by the home workload card (2026-10-19) for a finance holder only: the caller checks
 * `canSeeFinance`. The home module never reads `finance_time_entries` itself (ADR 0027).
 */
export async function weekMinutesByUser(
  db: Db,
  userIds: readonly string[],
  range: { from: string; until: string },
): Promise<Map<string, number>> {
  if (userIds.length === 0) return new Map();
  const e = financeTimeEntries;
  const rows = await db
    .select({ userId: e.userId, minutes: sql<number>`sum(${e.minutes})::int` })
    .from(e)
    .where(sql`${inArray(e.userId, [...userIds])} and ${countedEntriesSql({ kind: 'all' }, range)}`)
    .groupBy(e.userId);
  return new Map(rows.map((r) => [r.userId, r.minutes]));
}
