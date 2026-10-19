import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';
import type {
  UserLanguage,
  WeeklySummaryContent,
  WeeklySummarySkipReason,
  WeeklySummarySource,
  WeeklySummaryStatus,
} from '@spolu/shared';
import { foldSql } from '../../infra/db/fold.js';
import { languageIn } from '../../infra/db/language-check.js';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';

/**
 * Weekly client summaries (spec 2026-10-19 §6). One row per client group and ISO week; kept
 * permanently (owner decision): no code path deletes or expires a row, only a group's deletion
 * cascades. Together the rows are the archive of work reports per client.
 */
export const weeklySummaries = pgTable(
  'weekly_summaries',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    /** `YYYY-Www` (ISO week, Bratislava): sorts as text. */
    week: text('week').notNull(),
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    windowEnd: timestamp('window_end', { withTimezone: true }).notNull(),
    status: text('status').$type<WeeklySummaryStatus>().notNull().default('preparing'),
    skipReason: text('skip_reason').$type<WeeklySummarySkipReason>(),
    /** null while preparing. */
    source: text('source').$type<WeeklySummarySource>(),
    aiFailed: boolean('ai_failed').notNull().default(false),
    language: text('language').$type<UserLanguage>().notNull().default('sk'),
    /** `WeeklySummaryContent`, validated by zod on every write. */
    content: jsonb('content').$type<WeeklySummaryContent>().notNull(),
    /** Plain text of the content for the archive search; rewritten on every content write. */
    searchText: text('search_text').notNull().default(''),
    /** Bumped by every write: optimistic concurrency. */
    version: integer('version').notNull().default(1),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    sentBy: text('sent_by').references(() => user.id, { onDelete: 'set null' }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The idempotent prepare; also the latest week of a group (order by week desc).
    unique('weekly_summaries_group_week_unique').on(t.groupId, t.week),
    check('weekly_summaries_week_check', sql`${t.week} ~ '^\\d{4}-W\\d{2}$'`),
    check('weekly_summaries_window_check', sql`${t.windowEnd} > ${t.windowStart}`),
    check(
      'weekly_summaries_status_check',
      sql`${t.status} in ('preparing', 'draft', 'sending', 'sent', 'skipped')`,
    ),
    check(
      'weekly_summaries_skip_reason_check',
      sql`${t.skipReason} is null or ${t.skipReason} in ('no_activity', 'manager')`,
    ),
    check(
      'weekly_summaries_source_check',
      sql`${t.source} is null or ${t.source} in ('ai', 'facts')`,
    ),
    check('weekly_summaries_language_check', languageIn(t.language)),
    // The list of one week and the manager reminder.
    index('weekly_summaries_week_status_group_idx').on(t.week, t.status, t.groupId),
    // The archive of one client by date range, read backwards (`window_end desc, id desc`).
    index('weekly_summaries_group_window_idx').on(t.groupId, t.windowEnd, t.id),
    // The archive of all clients by date range, read backwards too.
    index('weekly_summaries_window_idx').on(t.windowEnd, t.id),
    // The archive's text search, folded like the global search.
    index('weekly_summaries_search_fold_trgm_idx').using(
      'gin',
      sql`${foldSql(t.searchText)} gin_trgm_ops`,
    ),
    // Older unsent drafts of a group (spec §12.2).
    index('weekly_summaries_group_draft_idx')
      .on(t.groupId, t.status)
      .where(sql`${t.status} = 'draft'`),
    // The stuck-job sweep: by the last change (a regeneration is an old row preparing again).
    index('weekly_summaries_stuck_idx')
      .on(t.status, t.updatedAt)
      .where(sql`${t.status} in ('preparing', 'sending')`),
    index('weekly_summaries_updated_by_idx').on(t.updatedBy),
    index('weekly_summaries_sent_by_idx').on(t.sentBy),
  ],
);

/** Who got a summary: frozen at Send. The email is blanked after 90 days, the row stays. */
export const weeklySummaryRecipients = pgTable(
  'weekly_summary_recipients',
  {
    summaryId: text('summary_id')
      .notNull()
      .references(() => weeklySummaries.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The name at Send, so the archive shows who got it after the person changes or leaves. */
    name: text('name').notNull(),
    /** null once blanked by the purge. */
    email: text('email'),
    language: text('language').$type<UserLanguage>().notNull(),
    status: text('status').$type<'pending' | 'sent' | 'failed'>().notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.summaryId, t.userId] }),
    check('weekly_summary_recipients_language_check', languageIn(t.language)),
    check(
      'weekly_summary_recipients_status_check',
      sql`${t.status} in ('pending', 'sent', 'failed')`,
    ),
    index('weekly_summary_recipients_user_idx').on(t.userId),
    index('weekly_summary_recipients_pending_idx')
      .on(t.summaryId)
      .where(sql`${t.status} = 'pending'`),
    // The purge of old addresses.
    index('weekly_summary_recipients_purge_idx')
      .on(t.sentAt)
      .where(sql`${t.email} is not null`),
  ],
);

/** Append-only: the content a regeneration or a restore replaced, kept permanently. */
export const weeklySummaryRevisions = pgTable(
  'weekly_summary_revisions',
  {
    id: text('id').primaryKey(),
    summaryId: text('summary_id')
      .notNull()
      .references(() => weeklySummaries.id, { onDelete: 'cascade' }),
    /** The summary's version the content had. */
    version: integer('version').notNull(),
    content: jsonb('content').$type<WeeklySummaryContent>().notNull(),
    language: text('language').$type<UserLanguage>().notNull(),
    source: text('source').$type<WeeklySummarySource>().notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('weekly_summary_revisions_language_check', languageIn(t.language)),
    check('weekly_summary_revisions_source_check', sql`${t.source} in ('ai', 'facts')`),
    // One summary's revisions, newest first (read backwards).
    index('weekly_summary_revisions_summary_idx').on(t.summaryId, t.createdAt),
    index('weekly_summary_revisions_created_by_idx').on(t.createdBy),
  ],
);

/** A group's switch; no row = on (spec §14 Q2). */
export const weeklySummaryGroupSettings = pgTable(
  'weekly_summary_group_settings',
  {
    groupId: text('group_id')
      .primaryKey()
      .references(() => groups.id, { onDelete: 'cascade' }),
    enabled: boolean('enabled').notNull(),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('weekly_summary_group_settings_updated_by_idx').on(t.updatedBy)],
);

/** A client who turned the summary off for one group. */
export const weeklySummaryUnsubscribes = pgTable(
  'weekly_summary_unsubscribes',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    index('weekly_summary_unsubscribes_group_idx').on(t.groupId),
  ],
);

/** An admin's "remind me" choice; no row = remind. */
export const weeklySummaryAdminPrefs = pgTable('weekly_summary_admin_prefs', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  remind: boolean('remind').notNull(),
});

/** One reminder per manager and week. */
export const weeklySummaryReminders = pgTable(
  'weekly_summary_reminders',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    week: text('week').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.week] })],
);
