import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { createDb, type Db } from '../src/infra/db/client.js';
import { runMigrations } from '../src/infra/db/migrate.js';

/**
 * Template databases for the EXPLAIN checks (ADR 0040). Each seed volume is built once into
 * `spolu_tpl_<volume>_<hash>`: migrated, seeded in one committed transaction and vacuumed, then
 * marked a template. Every explain run clones it (`setup-explain-db.ts`), so a run pays a file
 * copy instead of a seeding, and a clone has no dead tuples and empty GIN pending lists.
 *
 * The hash covers everything that changes the template's content: the migrations, the volume's
 * seed files, this file, the PostgreSQL version and the day (UTC). The seeds place rows relative
 * to `now()` and `current_date` (the last 90 days, a year ahead), so a template is rebuilt each
 * day rather than drift away from the checks' "today". A change to any of them builds a new
 * template; templates of other hashes are dropped once unused for a day (other worktrees may
 * still be on them).
 */

export type Volume = {
  name: string;
  /** The files whose content the template depends on, next to the migrations (absolute). */
  files: string[];
  /** Seeds the volume; runs in one transaction that is committed. */
  seed: (tx: Db) => Promise<void>;
  /** The tables vacuumed and analyzed after the seed; the others keep fresh statistics. */
  tables: readonly string[];
};

export const TEMPLATE_PREFIX = 'spolu_tpl_';
const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000;
const migrationsDir = fileURLToPath(new URL('../src/infra/db/migrations', import.meta.url));
const thisFile = fileURLToPath(import.meta.url);
const serverRoot = fileURLToPath(new URL('..', import.meta.url));

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

/** `url` with its database replaced by `name`. */
export function databaseUrl(url: string, name: string): string {
  const next = new URL(url);
  next.pathname = `/${name}`;
  return next.toString();
}

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [path];
    })
    .sort();
}

/** sha256 of the migrations, the volume's files, this file, the server version and `day`. */
export function templateHash(volume: Volume, serverVersion: string, day: string): string {
  const hash = createHash('sha256');
  for (const path of [...filesUnder(migrationsDir), ...volume.files, thisFile]) {
    hash.update(relative(serverRoot, path)).update('\0');
    hash.update(readFileSync(path)).update('\0');
  }
  return hash.update(serverVersion).update('\0').update(day).digest('hex').slice(0, 10);
}

type Admin = postgres.Sql;

const lock = (admin: Admin, name: string) =>
  admin`select pg_advisory_lock(hashtextextended(${name}, 0))`;
const unlock = (admin: Admin, name: string) =>
  admin`select pg_advisory_unlock(hashtextextended(${name}, 0))`;

/**
 * Returns the name of the volume's template, building it first if it is missing. An advisory
 * lock on the name makes parallel runs wait for one build instead of building twice.
 */
export async function ensureTemplate(adminUrl: string, volume: Volume): Promise<string> {
  const admin = postgres(adminUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const [row] = await admin<{ server_version_num: string }[]>`show server_version_num`;
    const day = new Date().toISOString().slice(0, 10);
    const hash = templateHash(volume, row!.server_version_num, day);
    const name = `${TEMPLATE_PREFIX}${volume.name}_${hash}`;
    await lock(admin, name);
    try {
      const found = await admin`select 1 from pg_database where datname = ${name}`;
      if (found.length === 0) await build(admin, adminUrl, name, volume);
      await admin.unsafe(`comment on database ${quote(name)} is 'used ${Date.now()}'`);
    } finally {
      await unlock(admin, name);
    }
    await prune(admin, volume.name, name);
    return name;
  } finally {
    await admin.end({ timeout: 5 });
  }
}

/**
 * Builds `<name>_building` (migrate, seed, commit, vacuum analyze the volume's tables), then
 * renames it and marks it a template. Autovacuum is off on every table while it builds, so no
 * table outside `volume.tables` gets statistics by chance and every build ends up the same.
 */
async function build(admin: Admin, adminUrl: string, name: string, volume: Volume): Promise<void> {
  const building = `${name}_building`;
  await admin.unsafe(`drop database if exists ${quote(building)} with (force)`);
  await admin.unsafe(`create database ${quote(building)}`);
  const url = databaseUrl(adminUrl, building);
  await runMigrations(url);
  const client = postgres(url, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const tables = (
      await client<{ name: string }[]>`
        select quote_ident(tablename) as name from pg_tables where schemaname = 'public'`
    ).map((row) => row.name);
    for (const table of tables) {
      await client.unsafe(`alter table ${table} set (autovacuum_enabled = false)`);
    }
    const { db, close } = createDb(url);
    try {
      await db.transaction((tx) => volume.seed(tx as unknown as Db));
    } finally {
      await close();
    }
    // Statistics, the visibility map and empty GIN pending lists, as autovacuum leaves a table.
    await client.unsafe(`vacuum (analyze) ${volume.tables.map(quote).join(', ')}`);
    for (const table of tables) {
      await client.unsafe(`alter table ${table} reset (autovacuum_enabled)`);
    }
  } finally {
    await client.end({ timeout: 5 });
  }
  await admin.unsafe(`alter database ${quote(building)} rename to ${quote(name)}`);
  await admin.unsafe(`alter database ${quote(name)} with is_template true allow_connections false`);
}

/**
 * Drops the volume's templates of other hashes unused for a day, and builds left by an aborted
 * run, each only while no run holds its lock.
 */
async function prune(admin: Admin, volume: string, keep: string): Promise<void> {
  const prefix = `${TEMPLATE_PREFIX}${volume}_`;
  const rows = await admin<{ datname: string; note: string | null }[]>`
    select datname, shobj_description(oid, 'pg_database') as note from pg_database
    where starts_with(datname, ${prefix}) and datname <> ${keep}`;
  for (const { datname, note } of rows) {
    const base = datname.replace(/_building$/, '');
    if (base === keep) continue;
    const used = Number(/^used (\d+)$/.exec(note ?? '')?.[1] ?? 0);
    if (datname === base && Date.now() - used < PRUNE_AFTER_MS) continue;
    const [free] = await admin<{ locked: boolean }[]>`
      select pg_try_advisory_lock(hashtextextended(${base}, 0)) as locked`;
    if (!free?.locked) continue;
    try {
      await admin.unsafe(`alter database ${quote(datname)} with is_template false`);
      await admin.unsafe(`drop database if exists ${quote(datname)} with (force)`);
    } finally {
      await unlock(admin, base);
    }
  }
}
