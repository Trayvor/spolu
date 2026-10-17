import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  type AnyPgColumn,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { Currency, FinanceItemType, TimeEntrySource } from '@spolu/shared';
import { files } from '../files/schema.js';
import { groups } from '../groups/schema.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';

/**
 * Finance (Phase 32, spec §3): every table of the module, created by one migration (part A1).
 * Only finance admins ever read them (`canSeeFinance`); no other module queries them, so no
 * knowledge list, search, chat picker or digest can show a finance row.
 */

/** A folder of one client's finance documents; `parent_id` null is the top level. */
export const financeFolders = pgTable(
  'finance_folders',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    // No action on delete: a folder's contents move up before it goes (the group's delete
    // cascades to every folder in one statement).
    parentId: text('parent_id').references((): AnyPgColumn => financeFolders.id),
    name: text('name').notNull(),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check('finance_folders_name_check', sql`char_length(${t.name}) between 1 and 100`),
    index('finance_folders_group_idx').on(t.groupId),
    index('finance_folders_parent_idx').on(t.parentId),
  ],
);

/**
 * A contract, document or note of one client. The five contract columns are set exactly for a
 * contract (one CHECK); money is integer minor units plus a currency, never converted.
 */
export const financeItems = pgTable(
  'finance_items',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    type: text('type').$type<FinanceItemType>().notNull(),
    folderId: text('folder_id').references(() => financeFolders.id),
    title: text('title').notNull(),
    /** Markdown, at most 10 000 characters. */
    body: text('body').notNull().default(''),
    contractNumber: text('contract_number'),
    amountMinor: bigint('amount_minor', { mode: 'number' }),
    currency: text('currency').$type<Currency>(),
    startsOn: date('starts_on', { mode: 'string' }),
    endsOn: date('ends_on', { mode: 'string' }),
    /** Title, number, body and file names, lower-cased without diacritics (trigram search). */
    searchText: text('search_text').notNull().default(''),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    /** Full precision: the list cursor carries the database's text of it, never a JS `Date`. */
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /** Millisecond precision, so the ISO string round-trips for the `409 finance_changed` check. */
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check('finance_items_type_check', sql`${t.type} in ('contract', 'document', 'note')`),
    check('finance_items_title_check', sql`char_length(${t.title}) between 1 and 200`),
    check('finance_items_body_check', sql`char_length(${t.body}) <= 10000`),
    check(
      'finance_items_contract_check',
      sql`case when ${t.type} = 'contract'
        then ${t.amountMinor} is not null and ${t.currency} is not null
          and ${t.startsOn} is not null and ${t.endsOn} is not null
        else ${t.amountMinor} is null and ${t.currency} is null and ${t.startsOn} is null
          and ${t.endsOn} is null and ${t.contractNumber} is null
        end`,
    ),
    check('finance_items_amount_check', sql`${t.amountMinor} is null or ${t.amountMinor} >= 0`),
    check(
      'finance_items_currency_check',
      sql`${t.currency} is null or ${t.currency} in ('EUR', 'UAH')`,
    ),
    check('finance_items_period_check', sql`${t.endsOn} is null or ${t.endsOn} >= ${t.startsOn}`),
    check(
      'finance_items_number_check',
      sql`${t.contractNumber} is null or char_length(${t.contractNumber}) <= 60`,
    ),
    // The card's list, newest first.
    index('finance_items_group_created_idx').on(
      t.groupId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // A folder's page.
    index('finance_items_folder_created_idx').on(
      t.folderId,
      t.groupId,
      t.createdAt.desc().nullsFirst(),
      t.id.desc().nullsFirst(),
    ),
    // Money by month and the paid ranking.
    index('finance_items_contract_starts_idx')
      .on(t.startsOn, t.groupId)
      .where(sql`${t.type} = 'contract'`),
    // "Ending soon".
    index('finance_items_contract_ends_idx')
      .on(t.endsOn)
      .where(sql`${t.type} = 'contract'`),
    index('finance_items_search_idx').using('gin', t.searchText.op('gin_trgm_ops')),
    index('finance_items_created_by_idx').on(t.createdBy),
  ],
);

/** The files of a finance item; only finance-only files (`files.finance_only`) are attached. */
export const financeAttachments = pgTable(
  'finance_attachments',
  {
    itemId: text('item_id')
      .notNull()
      .references(() => financeItems.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.fileId] }),
    index('finance_attachments_file_idx').on(t.fileId),
  ],
);

/**
 * Time an admin spent for a client: from a completed task (`task`, one entry per admin per task),
 * from a resolved ticket (`ticket`, one entry per admin per ticket; 2026-10-17 extension) or
 * entered by a finance admin (`manual`). `minutes` null = requested, not answered yet;
 * `worked_on` null only for a task or ticket entry filled before its subject was ever completed
 * or resolved. A task or ticket entry keeps its `source` and `title` after the subject is deleted
 * (`task_id` / `ticket_id` set null).
 *
 * A ticket and the tasks made from it (`tasks.source_ticket_id`) form one unit in the work log:
 * a task entry stores that ticket in `linked_ticket_id` (copied from the task by the hooks, so
 * finance never joins `tasks`). Ticket entries and task entries are separate rows, so every
 * total counts each once. `covered_by_tasks`: the admin answered that the hours on the linked
 * tasks already cover the ticket (option b) — a filled entry of 0 minutes, so it adds nothing.
 */
export const financeTimeEntries = pgTable(
  'finance_time_entries',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** The admin who worked (never a client: checked by the service). */
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    source: text('source').$type<TimeEntrySource>().notNull(),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    ticketId: text('ticket_id').references(() => tickets.id, { onDelete: 'set null' }),
    /** A task entry's ticket (the task's `source_ticket_id` when the entry was written). */
    linkedTicketId: text('linked_ticket_id').references(() => tickets.id, {
      onDelete: 'set null',
    }),
    /** The task's or ticket's title when the entry was created or last filled (a deleted subject). */
    title: text('title'),
    minutes: integer('minutes'),
    workedOn: date('worked_on', { mode: 'string' }),
    /** A ticket entry answered "the linked tasks' hours cover it" (option b): minutes are 0. */
    coveredByTasks: boolean('covered_by_tasks').notNull().default(false),
    note: text('note').notNull().default(''),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    updatedBy: text('updated_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    filledAt: timestamp('filled_at', { withTimezone: true, precision: 3 }),
  },
  (t) => [
    check('finance_time_entries_source_check', sql`${t.source} in ('task', 'ticket', 'manual')`),
    check(
      'finance_time_entries_minutes_check',
      sql`${t.minutes} is null or ${t.minutes} between 0 and 6000`,
    ),
    check('finance_time_entries_note_check', sql`char_length(${t.note}) <= 500`),
    // The subject columns follow the source (both may be null once the subject is deleted).
    check(
      'finance_time_entries_subject_check',
      sql`case ${t.source}
        when 'task' then ${t.ticketId} is null
        when 'ticket' then ${t.taskId} is null and ${t.linkedTicketId} is null
        else ${t.taskId} is null and ${t.ticketId} is null and ${t.linkedTicketId} is null
        end`,
    ),
    check(
      'finance_time_entries_manual_check',
      sql`${t.source} <> 'manual' or (${t.minutes} is not null and ${t.workedOn} is not null)`,
    ),
    check(
      'finance_time_entries_title_check',
      sql`${t.source} = 'manual' or ${t.title} is not null`,
    ),
    check(
      'finance_time_entries_covered_check',
      sql`not ${t.coveredByTasks} or (${t.source} = 'ticket' and ${t.minutes} = 0)`,
    ),
    // One entry per admin per task, and per admin per ticket.
    uniqueIndex('finance_time_entries_task_user_unique')
      .on(t.taskId, t.userId)
      .where(sql`${t.taskId} is not null`),
    uniqueIndex('finance_time_entries_ticket_user_unique')
      .on(t.ticketId, t.userId)
      .where(sql`${t.ticketId} is not null`),
    // The work log and the client aggregates.
    index('finance_time_entries_group_day_idx')
      .on(t.groupId, t.workedOn, t.id)
      .where(sql`${t.minutes} is not null and ${t.workedOn} is not null`),
    // System-wide aggregates and the hours ranking.
    index('finance_time_entries_day_group_idx')
      .on(t.workedOn, t.groupId)
      .where(sql`${t.minutes} is not null and ${t.workedOn} is not null`),
    // The per-admin filter and the rates join.
    index('finance_time_entries_user_day_idx')
      .on(t.userId, t.workedOn)
      .where(sql`${t.minutes} is not null and ${t.workedOn} is not null`),
    // My open requests (the dashboard).
    index('finance_time_entries_open_requests_idx')
      .on(t.userId)
      .where(sql`${t.minutes} is null and ${t.workedOn} is not null`),
    // The foreign keys' lookups (a deleted task or ticket) and the hooks' "entries of a task".
    index('finance_time_entries_task_idx')
      .on(t.taskId)
      .where(sql`${t.taskId} is not null`),
    // A ticket's unit: its own entries and those of its linked tasks, in one index range.
    index('finance_time_entries_unit_idx')
      .on(sql`coalesce(${t.ticketId}, ${t.linkedTicketId})`, t.workedOn)
      .where(sql`${t.ticketId} is not null or ${t.linkedTicketId} is not null`),
    // The `linked_ticket_id` foreign key's lookup (a deleted ticket).
    index('finance_time_entries_linked_ticket_idx')
      .on(t.linkedTicketId)
      .where(sql`${t.linkedTicketId} is not null`),
  ],
);

/**
 * An admin's hourly rate from a day on (EUR minor units). `effective_from` null = "from the
 * start" (only one such row per admin). An entry's rate is the row with the latest
 * `effective_from <= worked_on`, null counting as the earliest.
 */
export const financeRates = pgTable(
  'finance_rates',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id),
    rateMinor: bigint('rate_minor', { mode: 'number' }).notNull(),
    currency: text('currency').$type<Currency>().notNull().default('EUR'),
    effectiveFrom: date('effective_from', { mode: 'string' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => user.id),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check('finance_rates_rate_check', sql`${t.rateMinor} > 0`),
    check('finance_rates_currency_check', sql`${t.currency} = 'EUR'`),
    uniqueIndex('finance_rates_user_from_unique').on(
      t.userId,
      sql`coalesce(${t.effectiveFrom}, '-infinity'::date)`,
    ),
    index('finance_rates_user_from_idx').on(t.userId, t.effectiveFrom.desc().nullsLast()),
  ],
);
