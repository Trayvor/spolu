import { index, jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';

/** One notification for one recipient; `deliveredAt` stays null until it has been delivered. */
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
  },
  (t) => [
    index('notification_events_user_delivered_idx').on(t.userId, t.deliveredAt),
    index('notification_events_created_at_idx').on(t.createdAt),
  ],
);
