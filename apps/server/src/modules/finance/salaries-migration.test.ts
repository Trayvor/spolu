import { randomUUID } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { testDatabaseUrl } from '../../../test/test-config.js';

/**
 * Migration 0069 (salaries, 2026-10-21, ADR 0065) on a database that has data: the salary
 * expenses with an admin become salaries of the same id (month, amount, note, files, author and
 * times kept, a `migrated` audit row on both sides), every other expense stays, the data part is
 * idempotent, and the upgraded database ends with exactly the schema of a fresh one. Two
 * databases of its own (named after the test database), dropped at the end.
 */
const adminUrl = process.env.ADMIN_DATABASE_URL ?? 'postgres://spolu:spolu@localhost:5432/spolu';
const migrationsDir = fileURLToPath(new URL('../../infra/db/migrations/', import.meta.url));
const TAG = '0069_finance_salaries';
const base = new URL(testDatabaseUrl).pathname.slice(1);
const names = { fresh: `${base}_m69_fresh`, up: `${base}_m69_up` };
const urlOf = (name: string) => {
  const url = new URL(testDatabaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
};

type Sql = ReturnType<typeof postgres>;

async function recreate(name: string): Promise<void> {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
    await admin.unsafe(`create database "${name}"`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function dropDb(name: string): Promise<void> {
  const admin = postgres(adminUrl, { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`drop database if exists "${name}" with (force)`);
  } finally {
    await admin.end({ timeout: 5 });
  }
}

async function migrateFrom(url: string, folder: string): Promise<void> {
  const client = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await migrate(drizzle(client), { migrationsFolder: folder });
  } finally {
    await client.end({ timeout: 5 });
  }
}

/** A copy of the migrations folder without 0069 and anything after it. */
function foldersBefore0069(): string {
  const dir = mkdtempSync(join(tmpdir(), 'spolu-m69-'));
  cpSync(migrationsDir, dir, { recursive: true });
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  const at = journal.entries.findIndex((e) => e.tag === TAG);
  if (at < 0) throw new Error(`${TAG} not in the journal`);
  journal.entries = journal.entries.slice(0, at);
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

/** The statements of 0069: before its data part, the data part, and after it. */
function parts(): { head: string[]; data: string[] } {
  const text = readFileSync(join(migrationsDir, `${TAG}.sql`), 'utf8');
  const start = text.indexOf('-- migrate salary expenses: start');
  const end = text.indexOf('-- migrate salary expenses: end');
  if (start < 0 || end < start) throw new Error('data markers not found');
  const split = (s: string) =>
    s
      .split('--> statement-breakpoint')
      .map((x) => x.trim())
      .filter((x) => x.replace(/--[^\n]*/g, '').trim().length > 0);
  return { head: split(text.slice(0, start)), data: split(text.slice(start, end)) };
}

/** Every table's columns, constraints and indexes, and the triggers, of `public`. */
async function schemaOf(sql: Sql): Promise<unknown> {
  const columns = await sql`
    select table_name, column_name, data_type, is_nullable, column_default, datetime_precision
    from information_schema.columns where table_schema = 'public'
    order by table_name, column_name`;
  const constraints = await sql`
    select c.conrelid::regclass::text as rel, c.conname, pg_get_constraintdef(c.oid) as def
    from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' order by 1, 2`;
  const indexes = await sql`
    select tablename, indexname, indexdef from pg_indexes where schemaname = 'public'
    order by 1, 2`;
  const triggers = await sql`
    select event_object_table, trigger_name, action_statement
    from information_schema.triggers where trigger_schema = 'public' order by 1, 2, 3`;
  return { columns, constraints, indexes, triggers };
}

describe('migration 0069: salary expenses become salaries', () => {
  let folder: string;
  let up: Sql;
  const ids = {
    payee: randomUUID(),
    author: randomUUID(),
    salary: randomUUID(),
    salaryNoTitle: randomUUID(),
    other: randomUUID(),
    document: randomUUID(),
    file: randomUUID(),
    otherFile: randomUUID(),
    reminder: randomUUID(),
  };

  beforeAll(async () => {
    folder = foldersBefore0069();
    await recreate(names.fresh);
    await recreate(names.up);
    await migrateFrom(urlOf(names.fresh), migrationsDir);
    await migrateFrom(urlOf(names.up), folder);
    up = postgres(urlOf(names.up), { max: 1, onnotice: () => {} });
    // Seed the database as it was before 0069.
    await up`insert into "user" (id, name, email, role) values
      (${ids.payee}, 'Eva Nováková', ${`${ids.payee}@example.com`}, 'admin'),
      (${ids.author}, 'Fero Financ', ${`${ids.author}@example.com`}, 'admin')`;
    await up`insert into files (id, group_id, uploaded_by, name, mime, size, storage_key, attached_at, finance_only)
      values (${ids.file}, null, ${ids.author}, 'vyplata.pdf', 'application/pdf', 10, 'k1', now(), true),
             (${ids.otherFile}, null, ${ids.author}, 'faktura.pdf', 'application/pdf', 10, 'k2', now(), true)`;
    await up`insert into finance_items (id, group_id, type, title, body, amount_minor, currency,
        starts_on, ends_on, expense_kind, payee_id, created_by, created_at, updated_at)
      values
        (${ids.salary}, null, 'expense', 'Výplata september', 'Prémia v cene', 250000, 'EUR',
         '2026-09-30', '2026-09-30', 'salary', ${ids.payee}, ${ids.author},
         '2026-10-01T08:00:00.123Z', '2026-10-02T09:00:00.456Z'),
        (${ids.salaryNoTitle}, null, 'expense', '', '', 0, 'EUR',
         '2026-08-15', '2026-08-15', 'salary', ${ids.payee}, ${ids.author}, now(), now()),
        (${ids.other}, null, 'expense', 'Server Hetzner', '', 4900, 'EUR',
         '2026-09-10', '2026-09-10', 'other', null, ${ids.author}, now(), now())`;
    await up`insert into finance_items (id, group_id, type, title, created_by)
      values (${ids.document}, null, 'document', 'Výplatná páska', ${ids.author})`;
    await up`insert into finance_attachments (item_id, file_id) values
      (${ids.salary}, ${ids.file}), (${ids.other}, ${ids.otherFile})`;
    await up`insert into reminder_sets (id, finance_item_id, created_by)
      values (${ids.reminder}, ${ids.salary}, ${ids.author})`;
  }, 120_000);

  afterAll(async () => {
    await up?.end({ timeout: 5 });
    await dropDb(names.fresh);
    await dropDb(names.up);
    rmSync(folder, { recursive: true, force: true });
  }, 60_000);

  it('the data part is idempotent: a second run changes nothing', async () => {
    const { head, data } = parts();
    const rollback = new Error('rollback');
    let checked = false;
    await up
      .begin(async (tx) => {
        for (const statement of head) await tx.unsafe(statement);
        const snapshot = async () => ({
          salaries: await tx`select * from finance_salaries order by id`,
          files: await tx`select * from finance_salary_attachments order by salary_id, file_id`,
          items: await tx`select id, type, expense_kind, title from finance_items order by id`,
          audit: await tx`select entity_type, entity_id, action, changes from audit_log
            where actor_label = 'migration 0069' order by entity_type, entity_id`,
        });
        for (const statement of data) await tx.unsafe(statement);
        const once = await snapshot();
        for (const statement of data) await tx.unsafe(statement);
        expect(await snapshot()).toEqual(once);
        expect(once.salaries).toHaveLength(2);
        checked = true;
        throw rollback;
      })
      .catch((error: unknown) => {
        if (error !== rollback) throw error;
      });
    expect(checked).toBe(true);
  });

  it('upgrades: salaries keep the id, month, amount, note, files, author and times', async () => {
    await migrateFrom(urlOf(names.up), migrationsDir);
    const salaries =
      await up`select id, payee_id, month::text as month, amount_minor::text as amount,
        currency, note, created_by, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') as created,
        to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') as updated
      from finance_salaries order by month desc`;
    expect([...salaries]).toEqual([
      {
        id: ids.salary,
        payee_id: ids.payee,
        month: '2026-09-01',
        amount: '250000',
        currency: 'EUR',
        note: 'Výplata september\n\nPrémia v cene',
        created_by: ids.author,
        created: '2026-10-01T08:00:00.123',
        updated: '2026-10-02T09:00:00.456',
      },
      expect.objectContaining({
        id: ids.salaryNoTitle,
        month: '2026-08-01',
        amount: '0',
        note: '',
      }),
    ]);
    const attachments = await up`select salary_id, file_id from finance_salary_attachments`;
    expect([...attachments]).toEqual([{ salary_id: ids.salary, file_id: ids.file }]);
    // The file itself stays, still attached and finance-only.
    const [file] = await up`select attached_at is not null as attached, finance_only from files
      where id = ${ids.file}`;
    expect(file).toEqual({ attached: true, finance_only: true });
  });

  it('removes the migrated expenses (their reminders with them) and keeps every other item', async () => {
    const items = await up`select id, type, expense_kind from finance_items
      where id in ${up([ids.salary, ids.salaryNoTitle, ids.other, ids.document])} order by title`;
    expect([...items]).toEqual(
      expect.arrayContaining([
        { id: ids.other, type: 'expense', expense_kind: 'other' },
        { id: ids.document, type: 'document', expense_kind: null },
      ]),
    );
    expect(items).toHaveLength(2);
    const otherFiles =
      await up`select file_id from finance_attachments where item_id = ${ids.other}`;
    expect([...otherFiles]).toEqual([{ file_id: ids.otherFile }]);
    const reminders = await up`select id from reminder_sets where id = ${ids.reminder}`;
    expect(reminders).toHaveLength(0);
  });

  it('writes a `migrated` audit row on the salary and on the expense, finance only', async () => {
    const rows =
      await up`select entity_type, entity_id, entity_label, category, action, actor_kind, changes
      from audit_log where entity_id = ${ids.salary} order by entity_type`;
    expect([...rows]).toEqual([
      {
        entity_type: 'finance_item',
        entity_id: ids.salary,
        entity_label: 'Výplata september',
        category: 'finance',
        action: 'migrated',
        actor_kind: 'system',
        changes: { salary: { to: { id: ids.salary, label: 'Eva Nováková · 2026-09' } } },
      },
      {
        entity_type: 'salary',
        entity_id: ids.salary,
        entity_label: 'Eva Nováková · 2026-09',
        category: 'finance',
        action: 'migrated',
        actor_kind: 'system',
        changes: {
          expense: { from: { id: ids.salary, label: 'Výplata september' } },
          person: { to: { id: ids.payee, label: 'Eva Nováková' } },
          month: { to: '2026-09' },
          amount: { to: { minor: 250000, currency: 'EUR' } },
        },
      },
    ]);
  });

  it('refuses a salary expense afterwards (only the neutral kind is left, no payee column)', async () => {
    await expect(
      up`insert into finance_items (id, type, title, amount_minor, currency, starts_on, ends_on,
          expense_kind, created_by)
        values (${randomUUID()}, 'expense', 'X', 1, 'EUR', '2026-01-01', '2026-01-01', 'salary',
          ${ids.author})`,
    ).rejects.toThrow(/finance_items_expense_kind_check/);
  });

  it('ends with exactly the schema of a fresh database', async () => {
    const fresh = postgres(urlOf(names.fresh), { max: 1, onnotice: () => {} });
    try {
      expect(await schemaOf(up)).toEqual(await schemaOf(fresh));
    } finally {
      await fresh.end({ timeout: 5 });
    }
  });
});
