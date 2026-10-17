import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { GroupMode } from '@spolu/shared';
import { groups } from '../groups/schema.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { taskUnseenPredicate, ticketUnseenPredicate } from './unseen-kinds.js';

export type GroupModeOrigin = 'user' | 'manager';

/**
 * One notification for one recipient; `deliveredAt` stays null until the delivery worker decided
 * it (set at insert when the recipient can get neither a push nor an email).
 * `emailDueAt` is when the batched email for it may go out, `emailedAt` when it went (or was
 * skipped). `dedupeKey` makes an event at most once per user, e.g. one deadline reminder per day.
 */
export const notificationEvents = pgTable(
  'notification_events',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id').references(() => groups.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    emailDueAt: timestamp('email_due_at', { withTimezone: true }),
    emailedAt: timestamp('emailed_at', { withTimezone: true }),
    dedupeKey: text('dedupe_key'),
  },
  (t) => [
    index('notification_events_user_delivered_idx').on(t.userId, t.deliveredAt),
    index('notification_events_created_at_idx').on(t.createdAt),
    // The cascade from a deleted group (the table is the largest one).
    index('notification_events_group_idx')
      .on(t.groupId)
      .where(sql`${t.groupId} is not null`),
    uniqueIndex('notification_events_dedupe_unique')
      .on(t.userId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('notification_events_undelivered_idx')
      .on(t.createdAt)
      .where(sql`${t.deliveredAt} is null`),
    index('notification_events_email_due_idx')
      .on(t.emailDueAt)
      .where(sql`${t.emailedAt} is null and ${t.emailDueAt} is not null`),
    // Unseen changes (2026-10-17): a user's counted events of one task or ticket, newest last.
    index('notification_events_unseen_task_idx')
      .on(t.userId, sql`(${t.payload} ->> 'taskId')`, t.createdAt)
      .where(taskUnseenPredicate(sql`${t.kind}`, sql`${t.payload}`)),
    index('notification_events_unseen_ticket_idx')
      .on(t.userId, sql`(${t.payload} ->> 'ticketId')`, t.createdAt)
      .where(ticketUnseenPredicate(sql`${t.kind}`, sql`${t.payload}`)),
  ],
);

/**
 * When a user last opened a task (its panel, either tab) or a ticket (its page): their counted
 * notification events of it created later are its unseen changes (`unseen.ts`, 2026-10-17).
 */
export const taskSeen = pgTable(
  'task_seen',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.taskId] }),
    // The cascade from a deleted task.
    index('task_seen_task_id_idx').on(t.taskId),
  ],
);

export const ticketSeen = pgTable(
  'ticket_seen',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.ticketId] }),
    index('ticket_seen_ticket_id_idx').on(t.ticketId),
  ],
);

/** One browser push subscription; a user has one per device. */
export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  },
  (t) => [index('push_subscriptions_user_id_idx').on(t.userId)],
);

/**
 * A user's mode for one group, overriding their default and the role default. `origin` is
 * `manager` for the `all` row written when the user became the group's manager (removed again
 * when they stop), and `user` for a mode the user chose (kept when they stop).
 */
export const groupNotificationSettings = pgTable(
  'group_notification_settings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<GroupMode>().notNull(),
    origin: text('origin').$type<GroupModeOrigin>().notNull().default('user'),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.groupId] }),
    index('group_notification_settings_group_id_idx').on(t.groupId),
    check('group_notification_settings_mode_check', sql`${t.mode} in ('all', 'mentions', 'off')`),
    check('group_notification_settings_origin_check', sql`${t.origin} in ('user', 'manager')`),
  ],
);
