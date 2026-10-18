import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { knowledgeMeetings } from '../knowledge/schema.js';
import { user } from '../users/schema.js';

/**
 * Teams T1: a Help admin's Microsoft account (Entra user), looked up by their email with
 * `GET /users/{email}` and kept for a day. The known organizers a pasted link is resolved
 * through.
 */
export const teamsOrganizers = pgTable(
  'teams_organizers',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The Entra object id (`participants.organizer.identity.user.id` in Graph). */
    entraUserId: text('entra_user_id').notNull(),
    upn: text('upn').notNull(),
    displayName: text('display_name'),
    checkedAt: timestamp('checked_at', { withTimezone: true, precision: 3 }).notNull(),
  },
  (t) => [uniqueIndex('teams_organizers_entra_user_unique').on(t.entraUserId)],
);

/**
 * Teams T1: the Teams side of one knowledge meeting ("call") item; the item stays the
 * user-facing object (owner answer 6). Deleted with the meeting.
 *
 * - `origin` `help`: Help created the calendar event (`event_id`, `ical_uid`, the public
 *   add-to-calendar page); `linked`: an admin connected a pasted link of a meeting made in Teams.
 * - `online_meeting_id` is null until Graph returns the event's online meeting (the poll job
 *   looks it up again).
 * - The public page's token is never stored: `calendar_nonce` derives it with APP_SECRET and
 *   `calendar_token_hash` (SHA-256) finds the row.
 */
export const teamsMeetingLinks = pgTable(
  'teams_meeting_links',
  {
    itemId: text('item_id')
      .primaryKey()
      .references(() => knowledgeMeetings.itemId, { onDelete: 'cascade' }),
    origin: text('origin').notNull(),
    organizerUserId: text('organizer_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    organizerEntraId: text('organizer_entra_id').notNull(),
    organizerName: text('organizer_name'),
    onlineMeetingId: text('online_meeting_id'),
    joinUrl: text('join_url').notNull(),
    eventId: text('event_id'),
    icalUid: text('ical_uid'),
    durationMinutes: integer('duration_minutes').notNull(),
    /** "Record and transcribe automatically" was asked for (owner answer 2). */
    recordAutomatically: boolean('record_automatically').notNull().default(false),
    /** Graph accepted `recordAutomatically` on the online meeting. */
    recordApplied: boolean('record_applied').notNull().default(false),
    /** `waiting`, `imported`, `available`, `none` or `failed` (`TeamsTranscriptStates`). */
    transcriptState: text('transcript_state').notNull().default('waiting'),
    /** The Graph transcript ids of the last import, so the same set is not fetched again. */
    transcriptIds: text('transcript_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    nextPollAt: timestamp('next_poll_at', { withTimezone: true, precision: 3 }),
    lastPolledAt: timestamp('last_polled_at', { withTimezone: true, precision: 3 }),
    /** The last Graph error code only (never a body: it may echo ids). */
    lastError: text('last_error'),
    calendarNonce: text('calendar_nonce'),
    calendarTokenHash: text('calendar_token_hash'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    check('teams_meeting_links_origin_check', sql`${t.origin} in ('help', 'linked')`),
    check(
      'teams_meeting_links_transcript_state_check',
      sql`${t.transcriptState} in ('waiting', 'imported', 'available', 'none', 'failed')`,
    ),
    check(
      'teams_meeting_links_calendar_check',
      sql`(${t.calendarNonce} is null) = (${t.calendarTokenHash} is null)`,
    ),
    // The poll job's due rows.
    index('teams_meeting_links_next_poll_idx')
      .on(t.nextPollAt)
      .where(sql`${t.nextPollAt} is not null`),
    uniqueIndex('teams_meeting_links_calendar_token_unique')
      .on(t.calendarTokenHash)
      .where(sql`${t.calendarTokenHash} is not null`),
    index('teams_meeting_links_organizer_user_idx').on(t.organizerUserId),
    index('teams_meeting_links_created_by_idx').on(t.createdBy),
  ],
);
