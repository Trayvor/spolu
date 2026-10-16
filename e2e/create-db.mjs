// Creates the e2e database when it does not exist yet: the name comes from DATABASE_URL
// (default spolu_e2e) and must contain "e2e", so this never touches a real database.
// Connects as the dev user to the `spolu` database; ADMIN_DATABASE_URL overrides.
import { createRequire } from 'node:module';
import process from 'node:process';
import { URL } from 'node:url';

// `postgres` is a dependency of the server package, not of the repo root.
const postgres = createRequire(import.meta.dirname + '/../apps/server/package.json')('postgres');

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu';
const databaseUrl = process.env.DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu_e2e';
const name = new URL(databaseUrl).pathname.slice(1);
if (!/^[a-z0-9_]*e2e[a-z0-9_]*$/.test(name)) {
  throw new Error(
    `Refusing to create database "${name}": the e2e database name must contain "e2e"`,
  );
}

const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
try {
  const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (rows.length === 0) await sql.unsafe(`CREATE DATABASE ${name}`);
} finally {
  await sql.end();
}
