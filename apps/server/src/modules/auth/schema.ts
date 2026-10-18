import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';

// Tables owned by better-auth; the shape must match what the library expects.
export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('session_user_id_idx').on(t.userId),
    // The daily cleanup of expired sessions (`auth/jobs.ts`, 2026-10-18).
    index('session_expires_at_idx').on(t.expiresAt),
  ],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/**
 * One-click sign-in links from the "Ticket created" email (ADR 0022). Only the SHA-256 hash of
 * the token is stored; a link signs its user in until `expires_at`, as often as it is used.
 * Owned by us, not by better-auth.
 */
export const ticketSignInLinks = pgTable(
  'ticket_sign_in_links',
  {
    id: text('id').primaryKey(),
    /** Hex SHA-256 of the token in the link. */
    tokenHash: text('token_hash').notNull().unique(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => [
    index('ticket_sign_in_links_user_id_idx').on(t.userId),
    index('ticket_sign_in_links_ticket_id_idx').on(t.ticketId),
    index('ticket_sign_in_links_expires_at_idx').on(t.expiresAt),
  ],
);
