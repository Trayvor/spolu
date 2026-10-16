import postgres from 'postgres';
import { runMigrations } from '../src/infra/db/migrate.js';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu';
const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_test';

// Vitest globalSetup: create the test database if missing, then migrate it.
export default async function setup(): Promise<void> {
  const dbName = new URL(testUrl).pathname.slice(1);
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const found = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (found.length === 0) await admin.unsafe(`create database "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  await runMigrations(testUrl);
  await retireLeftoverAdmins(dbName);
}

/**
 * Deactivates the admins earlier runs left in the shared test database. Each test makes its own
 * admins, but a ticket without a client notifies every active admin, so leftovers made every run
 * slower than the last. Superadmins stay.
 */
async function retireLeftoverAdmins(dbName: string): Promise<void> {
  if (!dbName.includes('test')) return;
  const db = postgres(testUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    await db`update "user" set disabled_at = now() where role = 'admin' and disabled_at is null`;
  } finally {
    await db.end({ timeout: 5 });
  }
}
