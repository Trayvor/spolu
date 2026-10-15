// Creates the e2e database (spolu_e2e) when it does not exist yet.
// Connects as the dev user to the `spolu` database; ADMIN_DATABASE_URL overrides.
import { createRequire } from 'node:module';
import process from 'node:process';

// `postgres` is a dependency of the server package, not of the repo root.
const postgres = createRequire(import.meta.dirname + '/../apps/server/package.json')('postgres');

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu';
const name = 'spolu_e2e';

const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
try {
  const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (rows.length === 0) await sql.unsafe(`CREATE DATABASE ${name}`);
} finally {
  await sql.end();
}
