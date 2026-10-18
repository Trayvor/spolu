import { sql } from 'drizzle-orm';
import { boolean, check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import type { McpScope } from '@spolu/shared';
import { user } from '../users/schema.js';

/**
 * Personal access tokens for the MCP server (2026-10-18, ADR 0033). Only the SHA-256 hash of a
 * token is stored; `prefix` is its first characters, for the owner's list. A token is valid
 * while it is not revoked, not expired and its user is an active admin.
 */
export const mcpTokens = pgTable(
  'mcp_tokens',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Hex SHA-256 of the token. */
    tokenHash: text('token_hash').notNull().unique(),
    prefix: text('prefix').notNull(),
    scope: text('scope').$type<McpScope>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    /** Updated at most once a minute (`authenticateToken`). */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('mcp_tokens_user_id_idx').on(t.userId),
    check('mcp_tokens_scope_check', sql`${t.scope} in ('read', 'write')`),
  ],
);

/**
 * Every write tool call of the AI, also a refused one: who, which tool, on what, how it ended.
 * Never the arguments or any content.
 */
export const mcpAuditLog = pgTable(
  'mcp_audit_log',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    tokenId: text('token_id').references(() => mcpTokens.id, { onDelete: 'set null' }),
    tool: text('tool').notNull(),
    targetId: text('target_id'),
    /** The HTTP status the tool's route answered (403 for a refused call). */
    status: integer('status').notNull(),
    ok: boolean('ok').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('mcp_audit_log_user_created_idx').on(t.userId, t.createdAt.desc()),
    index('mcp_audit_log_token_id_idx').on(t.tokenId),
  ],
);
