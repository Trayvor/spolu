import { sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * Test-only: the finance volume of spec §10 for the `EXPLAIN` checks. It is seeded once into a
 * template database (`test/explain-templates.ts`, committed and vacuumed) that each explain run
 * clones, so its three tests share one seeding with no dead tuples. D reuses it for the rankings
 * and the system-wide overview.
 */

export type FinanceVolumeIds = { groupIds: string[]; adminIds: string[] };

/** The fixed id prefix: the ids are known without reading the clone. */
const p = 'ffinance00000';

const FINANCE_VOLUME = {
  groups: 3100,
  admins: 40,
  /** Filled entries over five years. */
  entries: 300_000,
  requested: 5000,
  contracts: 20_000,
  /** Five per admin: "from the start" and one a year since. */
  rates: 200,
  days: 1826,
  /** Phase 32 E: contracts of several clients, three shares each, over the contracts' years. */
  sharedContracts: 2000,
  sharesPerContract: 3,
  /** Phase 32 E: the organisation's expenses over five years and a year ahead. */
  expenses: 3000,
  /** 2026-10-21: the admins' salaries, one per admin per month over five years and a year ahead. */
  salaries: 2880,
  /** Phase 32 E: the organisation's notes. */
  orgNotes: 1000,
} as const;

/** The ids of the seeded volume. */
export function financeVolumeIds(): FinanceVolumeIds {
  const v = FINANCE_VOLUME;
  return {
    groupIds: Array.from({ length: v.groups }, (_, i) => `${p}-g${i + 1}`),
    adminIds: Array.from({ length: v.admins }, (_, i) => `${p}-a${i + 1}`),
  };
}

/**
 * The tables the template vacuums and analyzes after the seed (the ones the seed analyzed when it
 * ran in a rolled-back transaction). Every other table keeps the statistics of a fresh database:
 * an empty one stays "never vacuumed", so the planner assumes a few pages there instead of
 * pricing a sequential scan of it at nothing, and the plans stay as they were.
 */
export const FINANCE_VOLUME_TABLES = [
  'user',
  'groups',
  'finance_time_entries',
  'finance_items',
  'finance_rates',
  'finance_contract_shares',
];

/**
 * Seeds the volume with `generate_series`: 3 100 clients, 40 admins, 300 000
 * filled time entries spread evenly over clients, admins and the last five years (a tenth from
 * tasks since deleted, a twentieth from tickets since deleted, the rest manual), 5 000 requested
 * entries of the last month, 20 000 contracts starting from four years ago to a year ahead, and
 * 200 rates; since Phase 32 E also 2 000 contracts of several clients (6 000 shares), 3 000
 * expenses and 1 000 notes of the organisation; since 2026-10-21 2 880 salaries.
 */
export async function seedFinanceVolume(tx: Db): Promise<void> {
  const v = FINANCE_VOLUME;
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
      project_id, event_id, created_by, updated_by, filled_at)
    select ${p} || '-e' || i, ${p} || '-g' || (i % ${v.groups} + 1), ${p} || '-a' || (i % ${v.admins} + 1),
      case when i % 10 = 0 then 'task' when i % 20 = 1 then 'ticket' else 'manual' end,
      case when i % 10 = 0 or i % 20 = 1 then 'Work ' || i end,
      15 + i % 240, current_date - (i % ${v.days}),
      -- Phase 33 P6: two thirds of the time on one of a client's 4 projects, a seventh on an event.
      case when i % 3 > 0 then ${p} || '-p' || (i % ${v.groups} + 1) || '-' || (i % 4) end,
      case when i % 3 > 0 and i % 7 = 0 then ${p} || '-v' || (i % ${v.groups} + 1) || '-' || (i % 4) end,
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
      ends_on, project_id, created_by)
    select ${p} || '-c' || i, ${p} || '-g' || (i % ${v.groups} + 1), 'contract', 'Contract ' || i,
      100000 + (i % 50) * 10000, 'EUR', current_date - (i % ${v.days}) + 365,
      current_date - (i % ${v.days}) + 730,
      case when i % 2 = 0 then ${p} || '-p' || (i % ${v.groups} + 1) || '-' || (i % 4) end,
      ${p} || '-a1'
    from generate_series(1, ${v.contracts}) i
  `);
  await tx.execute(sql`
    insert into finance_rates (id, user_id, rate_minor, effective_from, created_by)
    select ${p} || '-rate' || a || '-' || k, ${p} || '-a' || a, 3000 + k * 500,
      case when k = 0 then null else current_date - (5 - k) * 365 end, ${p} || '-a1'
    from generate_series(1, ${v.admins}) a cross join generate_series(0, 4) k
  `);
  // Phase 32 E: contracts of several clients (shares of clients i, i + 1000 and i + 2000).
  await tx.execute(sql`
    insert into finance_items (id, group_id, type, title, amount_minor, currency, starts_on,
      ends_on, payer_name, created_by)
    select ${p} || '-sc' || i, null, 'contract', 'Shared contract ' || i, 300000, 'EUR',
      current_date - (i % ${v.days}) + 365, current_date - (i % ${v.days}) + 730,
      'Payer ' || (i % 50), ${p} || '-a1'
    from generate_series(1, ${v.sharedContracts}) i
  `);
  await tx.execute(sql`
    insert into finance_contract_shares (item_id, group_id, amount_minor)
    select ${p} || '-sc' || i, ${p} || '-g' || ((i + k * 1000) % ${v.groups} + 1), 100000
    from generate_series(1, ${v.sharedContracts}) i
      cross join generate_series(0, ${v.sharesPerContract - 1}) k
  `);
  await tx.execute(sql`
    insert into finance_items (id, group_id, type, title, amount_minor, currency, starts_on,
      ends_on, expense_kind, created_by)
    select ${p} || '-x' || i, null, 'expense', 'Expense ' || i, 1000 + i % 500, 'EUR',
      current_date - (i % ${v.days}) + 365, current_date - (i % ${v.days}) + 365,
      'other', ${p} || '-a1'
    from generate_series(1, ${v.expenses}) i
  `);
  // One salary per admin and month: 40 admins x 72 months.
  await tx.execute(sql`
    insert into finance_salaries (id, payee_id, month, amount_minor, created_by)
    select ${p} || '-s' || i, ${p} || '-a' || (i % ${v.admins} + 1),
      (date_trunc('month', current_date) + interval '1 year'
        - make_interval(months => i / ${v.admins}))::date,
      200000 + i % 500, ${p} || '-a1'
    from generate_series(0, ${v.salaries - 1}) i
  `);
  await tx.execute(sql`
    insert into finance_items (id, group_id, type, title, created_by)
    select ${p} || '-on' || i, null, 'note', 'Org note ' || i, ${p} || '-a1'
    from generate_series(1, ${v.orgNotes}) i
  `);
}
