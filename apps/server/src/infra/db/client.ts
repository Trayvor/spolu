import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';

export type Db = PostgresJsDatabase;

const PING_TIMEOUT_MS = 2000;
const POOL_SIZE = 10;

export function createDb(databaseUrl: string): { db: Db; close(): Promise<void> } {
  const client = postgres(databaseUrl, { max: POOL_SIZE, connect_timeout: 2 });
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
