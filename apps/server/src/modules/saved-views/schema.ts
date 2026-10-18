import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { SavedViewPage } from '@spolu/shared';
import { user } from '../users/schema.js';

/**
 * Saved views (F5, 2026-10-18): a person's named filter set of one list page, as the page's URL.
 * Read per person and page, in creation order.
 */
export const savedViews = pgTable(
  'saved_views',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    page: text('page').$type<SavedViewPage>().notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('saved_views_user_page_idx').on(t.userId, t.page, t.createdAt),
    check('saved_views_page_check', sql`${t.page} in ('board', 'tickets', 'knowledge')`),
  ],
);
