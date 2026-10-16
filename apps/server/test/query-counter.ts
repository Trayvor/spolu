import { createDb, type Db } from '../src/infra/db/client.js';
import { testDatabaseUrl } from './test-config.js';

/**
 * A database handle on the test database that counts the queries sent through it, for tests
 * that assert a read stays a fixed number of queries (no N+1).
 */
export function createCountingDb(): {
  db: Db;
  count(): number;
  reset(): void;
  close(): Promise<void>;
} {
  let queries = 0;
  const { db, close } = createDb(testDatabaseUrl, { onQuery: () => void queries++ });
  return {
    db,
    count: () => queries,
    reset: () => void (queries = 0),
    close,
  };
}
