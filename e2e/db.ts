import { createRequire } from 'node:module';
import process from 'node:process';

// `postgres` is a dependency of the server package, not of the repo root (as in create-db.mjs).
type Sql = {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Record<string, unknown>[]>;
  end(options?: { timeout?: number }): Promise<void>;
};
const postgres = createRequire(import.meta.dirname + '/../apps/server/package.json')(
  'postgres',
) as (url: string, options?: Record<string, unknown>) => Sql;

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_e2e';

/**
 * Runs `fn` against the e2e database, for the few steps a test cannot reach through the API
 * (such as moving a reminder time into the past). Refuses any database whose name lacks "e2e".
 */
export async function withDb<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!name.includes('e2e')) throw new Error(`Refusing to touch database "${name}"`);
  const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  try {
    return await fn(sql);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
