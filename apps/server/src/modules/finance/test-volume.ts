import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: the finance volume of spec §10 for the `EXPLAIN` checks, seeded and rolled back.
 * D reuses it for the rankings and the system-wide overview.
 */

export type FinanceVolumeIds = { groupIds: string[]; adminIds: string[] };

class Rollback extends Error {}

export const FINANCE_VOLUME = {
  groups: 3100,
  admins: 40,
  /** Filled entries over five years. */
  entries: 300_000,
  requested: 5000,
  contracts: 20_000,
  /** Five per admin: "from the start" and one a year since. */
  rates: 200,
  days: 1826,
} as const;

/**
 * Opens a transaction and seeds it with `generate_series`: 3 100 clients, 40 admins, 300 000
 * filled time entries spread evenly over clients, admins and the last five years (a tenth from
 * tasks since deleted, a twentieth from tickets since deleted, the rest manual), 5 000 requested
 * entries of the last month, 20 000 contracts starting from four years ago to a year ahead, and
 * 200 rates. Runs `analyze`, calls `fn`, then rolls everything back.
 */
export async function withFinanceVolume(
  db: Db,
  fn: (tx: Db, ids: FinanceVolumeIds) => Promise<void>,
): Promise<void> {
  const v = FINANCE_VOLUME;
  const p = `f${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const groupIds = Array.from({ length: v.groups }, (_, i) => `${p}-g${i + 1}`);
  const adminIds = Array.from({ length: v.admins }, (_, i) => `${p}-a${i + 1}`);
  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into "user" (id, name, email, email_verified, role, finance_access_at)
        select ${p} || '-a' || i, 'Admin ' || i, ${p} || '-a' || i || '@example.com', true, 'admin', now()
        from generate_series(1, ${v.admins}) i
      `);
      await tx.execute(sql`
        insert into groups (id, name, egrant_url, invite_token)
        select ${p} || '-g' || i, 'Client ' || lpad(i::text, 4, '0'),
          'https://' || ${p} || i || '.egrant.sk', ${p} || '-invite-' || i
        from generate_series(1, ${v.groups}) i
      `);
      // Entry i: client (i % 3100) + 1, admin (i % 40) + 1, (i % 1826) days ago.
      await tx.execute(sql`
        insert into finance_time_entries (id, group_id, user_id, source, title, minutes, worked_on,
          created_by, updated_by, filled_at)
        select ${p} || '-e' || i, ${p} || '-g' || (i % ${v.groups} + 1), ${p} || '-a' || (i % ${v.admins} + 1),
          case when i % 10 = 0 then 'task' when i % 20 = 1 then 'ticket' else 'manual' end,
          case when i % 10 = 0 or i % 20 = 1 then 'Work ' || i end,
          15 + i % 240, current_date - (i % ${v.days}),
          ${p} || '-a1', ${p} || '-a1', now()
        from generate_series(1, ${v.entries}) i
      `);
      await tx.execute(sql`
        insert into finance_time_entries (id, group_id, user_id, source, title, worked_on,
          created_by, updated_by)
        select ${p} || '-r' || i, ${p} || '-g' || (i % ${v.groups} + 1), ${p} || '-a' || (i % ${v.admins} + 1),
          'task', 'Task ' || i, current_date - (i % 30), ${p} || '-a1', ${p} || '-a1'
        from generate_series(1, ${v.requested}) i
      `);
      await tx.execute(sql`
        insert into finance_items (id, group_id, type, title, amount_minor, currency, starts_on,
          ends_on, created_by)
        select ${p} || '-c' || i, ${p} || '-g' || (i % ${v.groups} + 1), 'contract', 'Contract ' || i,
          100000 + (i % 50) * 10000, 'EUR', current_date - (i % ${v.days}) + 365,
          current_date - (i % ${v.days}) + 730, ${p} || '-a1'
        from generate_series(1, ${v.contracts}) i
      `);
      await tx.execute(sql`
        insert into finance_rates (id, user_id, rate_minor, effective_from, created_by)
        select ${p} || '-rate' || a || '-' || k, ${p} || '-a' || a, 3000 + k * 500,
          case when k = 0 then null else current_date - (5 - k) * 365 end, ${p} || '-a1'
        from generate_series(1, ${v.admins}) a cross join generate_series(0, 4) k
      `);
      for (const table of [
        'user',
        'groups',
        'finance_time_entries',
        'finance_items',
        'finance_rates',
      ]) {
        await tx.execute(sql.raw(`analyze "${table}"`));
      }
      await fn(tx as unknown as Db, { groupIds, adminIds });
      throw new Rollback();
    });
  } catch (error) {
    if (!(error instanceof Rollback)) throw error;
  }
}
