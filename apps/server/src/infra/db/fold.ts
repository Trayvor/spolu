import { sql, type AnyColumn, type SQL } from 'drizzle-orm';

/**
 * Global search (2026-10-18): `text` folded the way `normalizeSearch` folds a query (NFD, the
 * combining marks U+0300–U+036F removed, lower-cased), as SQL: the database function
 * `spolu_fold` (migration 0055). It is immutable, so it can be indexed, and a PL/pgSQL function
 * with a high `COST`, so the planner knows that folding every row of a table is dear and reads
 * the trigram index instead (an inlined expression costs almost nothing to it, and it chose a
 * sequential scan of `groups` that took 13 ms). Its own file: the schema files import it.
 */
export function foldSql(text: SQL | AnyColumn): SQL {
  return sql`spolu_fold(${text})`;
}
