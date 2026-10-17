import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type { TicketSource, TicketStatus } from '@spolu/shared';
import { files } from '../files/schema.js';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';

/**
 * A support ticket (Phase 21). `group_id` null: no client matched the instance link yet; only
 * admins see it. The requester's name, email and phone are kept as received even when
 * `requester_user_id` links their account.
 */
export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    /** Shown as `#123`; one sequence for every ticket. */
    number: integer('number').notNull().generatedAlwaysAsIdentity().unique('tickets_number_unique'),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    status: text('status').$type<TicketStatus>().notNull().default('new'),
    source: text('source').$type<TicketSource>().notNull(),
    requesterUserId: text('requester_user_id').references(() => user.id, { onDelete: 'set null' }),
    requesterName: text('requester_name'),
    requesterEmail: text('requester_email'),
    requesterPhone: text('requester_phone'),
    area: text('area'),
    subject: text('subject'),
    programme: text('programme'),
    body: text('body'),
    dueDate: date('due_date', { mode: 'string' }),
    url: text('url'),
    instanceUrl: text('instance_url'),
    /** eGrant's idempotency key from the intake: one ticket per key; null for manual tickets. */
    requestId: text('request_id').unique('tickets_request_id_unique'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    /** When the "Ticket created" email went to the initiator; it goes at most once. */
    requesterNotifiedAt: timestamp('requester_notified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [
    check('tickets_status_check', sql`${t.status} in ('new', 'in_progress', 'resolved')`),
    check('tickets_source_check', sql`${t.source} in ('api', 'manual')`),
    index('tickets_group_status_created_idx').on(t.groupId, t.status, t.createdAt.desc()),
    index('tickets_requester_created_idx').on(t.requesterUserId, t.createdAt.desc()),
    // The admins' global list (`scope=all`), newest first with no group filter.
    index('tickets_created_idx').on(t.createdAt.desc().nullsFirst(), t.id.desc().nullsFirst()),
    index('tickets_unassigned_created_idx')
      .on(t.createdAt.desc())
      .where(sql`${t.groupId} is null`),
    index('tickets_due_open_idx')
      .on(t.dueDate)
      .where(sql`${t.status} <> 'resolved'`),
  ],
);

/** Who follows a ticket: `auto` (initiator, managers, the creating admin) or `manual`. */
export const ticketFollowers = pgTable(
  'ticket_followers',
  {
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    source: text('source').$type<'auto' | 'manual'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.userId] }),
    check('ticket_followers_source_check', sql`${t.source} in ('auto', 'manual')`),
    index('ticket_followers_user_idx').on(t.userId),
  ],
);

/**
 * The riešitelia (assignees) of a ticket: admins, or clients of the ticket's group. Adding one
 * also makes them a follower; removing one leaves the follow alone.
 */
export const ticketAssignees = pgTable(
  'ticket_assignees',
  {
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.userId] }),
    index('ticket_assignees_user_idx').on(t.userId),
  ],
);

/**
 * A user's own "Watch tickets" choice for one client group. Without a row the default applies:
 * on for the group's clients and its managers, off for other admins (`watch.ts`).
 */
export const ticketWatchSettings = pgTable(
  'ticket_watch_settings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    watching: boolean('watching').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    index('ticket_watch_settings_group_idx').on(t.groupId),
  ],
);

/** Files uploaded with a ticket created by hand, or sent with it to the intake. */
export const ticketAttachments = pgTable(
  'ticket_attachments',
  {
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    fileId: text('file_id')
      .notNull()
      .references(() => files.id, { onDelete: 'cascade' }),
    /** The order the files were sent or picked in. */
    position: integer('position').notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.ticketId, t.fileId] }),
    index('ticket_attachments_file_idx').on(t.fileId),
  ],
);
