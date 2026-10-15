// Creates the e2e database when it does not exist yet: the name comes from DATABASE_URL (default spolu_e2e).
// Connects as the dev user to the `spolu` database; ADMIN_DATABASE_URL overrides.
import { createRequire } from 'node:module';
import process from 'node:process';

// `postgres` is a dependency of the server package, not of the repo root.
const postgres = createRequire(import.meta.dirname + '/../apps/server/package.json')('postgres');

const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu';
const name = new URL(process.env.DATABASE_URL ?? 'postgres://x@h/spolu_e2e').pathname.slice(1);
if (!/^[a-z0-9_]+$/i.test(name)) throw new Error(`Unsafe database name: ${name}`);
// Never create or use the dev database by accident (an exported dev DATABASE_URL).
if (!name.includes('e2e'))
  throw new Error(`Refusing database "${name}": the e2e name must contain "e2e"`);

const sql = postgres(adminUrl, { max: 1, onnotice: () => {} });
try {
  const rows = await sql`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (rows.length === 0) await sql.unsafe(`CREATE DATABASE ${name}`);
} finally {
  await sql.end();
}
