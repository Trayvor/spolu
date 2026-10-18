import { sql } from 'drizzle-orm';
import { boolean, index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from '../users/schema.js';

/**
 * Canned replies (F7, 2026-10-18): an admin's snippet, private to them or shared with every
 * admin. Read per admin (own) and for everyone (shared); at most a few hundred rows in all.
 */
export const replySnippets = pgTable(
  'reply_snippets',
  {
    id: text('id').primaryKey(),
    authorId: text('author_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body').notNull(),
    shared: boolean('shared').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('reply_snippets_author_id_idx').on(t.authorId),
    index('reply_snippets_shared_idx')
      .on(t.id)
      .where(sql`${t.shared}`),
  ],
);
