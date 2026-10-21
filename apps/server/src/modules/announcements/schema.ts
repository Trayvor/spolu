import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from '../users/schema.js';

/**
 * "What's new" (ADR 0067): who has closed which announcement. The announcements themselves are in
 * code (`catalogue.ts`); a row means "seen, never show it again", on every device. Read by the
 * primary key once per app load; one row per person and announcement.
 */
export const announcementSeen = pgTable(
  'announcement_seen',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    announcementId: text('announcement_id').notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.announcementId] })],
);
