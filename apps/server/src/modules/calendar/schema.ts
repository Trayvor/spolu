import { boolean, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { user } from '../users/schema.js';

/**
 * The personal calendar feed of a person (ADR 0051): one row each. The feed's URL holds a token
 * derived from `APP_SECRET`, the user and `nonce` (`token.ts`); only its SHA-256 is stored, the
 * fetch's one lookup. Rotating writes a new nonce and hash; revoking deletes the row.
 */
export const calendarFeeds = pgTable('calendar_feeds', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  /** 16 random bytes, base64url. */
  nonce: text('nonce').notNull(),
  /** Hex SHA-256 of the derived token. */
  tokenHash: text('token_hash').notNull().unique('calendar_feeds_token_hash_unique'),
  includeEvents: boolean('include_events').notNull().default(true),
  /** The deadlines of the tasks assigned to the person. */
  includeTasks: boolean('include_tasks').notNull().default(true),
  includeCalls: boolean('include_calls').notNull().default(true),
  /** Noted at most once an hour (`touchFetched`). */
  lastFetchedAt: timestamp('last_fetched_at', { withTimezone: true, precision: 3 }),
  createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
});
