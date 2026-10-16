import { sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { UserLanguages } from '@spolu/shared';

/**
 * `<column> in ('sk', 'en', …)`: the check of a `language` column, built from `UserLanguages`
 * so the database accepts exactly the languages the app has. A new language changes this SQL,
 * so `db:generate` writes the migration that replaces the checks.
 */
export function languageIn(column: PgColumn): SQL {
  return sql`${column} in (${sql.raw(UserLanguages.map((l) => `'${l}'`).join(', '))})`;
}
