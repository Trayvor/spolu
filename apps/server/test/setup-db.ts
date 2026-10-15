import postgres from 'postgres';
import { runMigrations } from '../src/infra/db/migrate.js';

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://ehub:ehub@localhost:5432/ehub';
const testUrl = process.env.TEST_DATABASE_URL ?? 'postgres://ehub:ehub@localhost:5432/ehub_test';

// Vitest globalSetup: create the test database if missing, then migrate it.
export default async function setup(): Promise<void> {
  const dbName = new URL(testUrl).pathname.slice(1);
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5 });
  try {
    const found = await admin`select 1 from pg_database where datname = ${dbName}`;
    if (found.length === 0) await admin.unsafe(`create database "${dbName.replace(/"/g, '""')}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
  await runMigrations(testUrl);
}
