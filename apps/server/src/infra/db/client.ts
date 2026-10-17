import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

export type Db = PostgresJsDatabase;

const PING_TIMEOUT_MS = 2000;
const POOL_SIZE = 10;

/** `onQuery` sees every query sent (tests count them, `test/query-counter.ts`). */
export function createDb(
  databaseUrl: string,
  opts: { onQuery?: (query: string) => void } = {},
): { db: Db; close(): Promise<void> } {
  const { onQuery } = opts;
  const client = postgres(databaseUrl, {
    max: POOL_SIZE,
    connect_timeout: 2,
    // JIT pays off for long analytical queries only. The planner's estimates for the statements
    // with correlated subqueries (the global board, the admin sidebar) pass `jit_above_cost`,
    // and compiling them took 620 ms of a 720 ms global board (Phase 27).
    connection: { jit: 'off' },
    ...(onQuery ? { debug: (_connection: number, query: string) => onQuery(query) } : {}),
  });
  return { db: drizzle(client), close: () => client.end({ timeout: 1 }) };
}

/** Runs `select 1`; false on any error or after 2 seconds. Never throws or hangs. */
export async function pingDb(db: Db): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
  });
  try {
    return await Promise.race([db.execute(sql`select 1`).then(() => true as const), timeout]);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
