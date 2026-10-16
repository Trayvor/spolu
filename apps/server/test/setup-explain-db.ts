import postgres from 'postgres';
import { runMigrations } from '../src/infra/db/migrate.js';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu';
const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_test';

/**
 * Vitest globalSetup of the EXPLAIN checks: a fresh, migrated database of their own
 * (`<test database>_explain`, recreated on every run), so the seeded volume is the whole data
 * set. The shared test database keeps thousands of groups from earlier runs, which would make
 * the per-client sidebar measure those instead. The URL reaches the test as
 * `EXPLAIN_DATABASE_URL`.
 */
export default async function setup(): Promise<void> {
  const url = new URL(testUrl);
  const name = `${url.pathname.slice(1)}_explain`;
  if (!name.endsWith('_explain')) throw new Error(`Refusing database "${name}"`);
  const quoted = `"${name.replace(/"/g, '""')}"`;
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists ${quoted} with (force)`);
    await admin.unsafe(`create database ${quoted}`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  url.pathname = `/${name}`;
  await runMigrations(url.toString());
  process.env.EXPLAIN_DATABASE_URL = url.toString();
}
