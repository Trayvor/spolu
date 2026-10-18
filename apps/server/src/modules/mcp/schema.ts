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
    /**
     * Set for the access token of an OAuth connection (ADR 0034): one row per connection, whose
     * hash and expiry change on every refresh. Null for a personal token.
     */
    oauthGrantId: text('oauth_grant_id')
      .unique()
      .references(() => mcpOAuthGrants.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('mcp_tokens_user_id_idx').on(t.userId),
    check('mcp_tokens_scope_check', sql`${t.scope} in ('read', 'write')`),
  ],
);

/**
 * OAuth clients that registered themselves (RFC 7591, ADR 0034). Only redirect addresses on the
 * allowed hosts are accepted (`oauth.ts`). A client without an active connection is deleted a day
 * after registration if never used, 30 days after its last use otherwise.
 */
export const mcpOAuthClients = pgTable('mcp_oauth_clients', {
  /** The `client_id`. */
  id: text('id').primaryKey(),
  /** Hex SHA-256 of the client secret; null for a public client (`none`). */
  secretHash: text('secret_hash'),
  authMethod: text('auth_method')
    .$type<'none' | 'client_secret_post' | 'client_secret_basic'>()
    .notNull(),
  /** The self-declared `client_name`, shown on the consent screen next to the redirect host. */
  name: text('name').notNull(),
  redirectUris: text('redirect_uris').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** The last token exchange or refresh. */
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
});

/**
 * A user's approval of a client (a "connection"): the scope chosen on the consent screen. Its
 * access token is the `mcp_tokens` row with this `oauth_grant_id`; its refresh tokens rotate and
 * a reused one revokes the connection. `expires_at` follows the newest refresh token.
 */
export const mcpOAuthGrants = pgTable(
  'mcp_oauth_grants',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => mcpOAuthClients.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    scope: text('scope').$type<McpScope>().notNull(),
    /** The redirect address approved, for the settings list. */
    redirectUri: text('redirect_uri').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  (t) => [
    index('mcp_oauth_grants_user_id_idx').on(t.userId),
    index('mcp_oauth_grants_client_id_idx').on(t.clientId),
    check('mcp_oauth_grants_scope_check', sql`${t.scope} in ('read', 'write')`),
  ],
);

/** Authorization codes: hashed, single use, two minutes; PKCE S256 challenge kept. */
export const mcpOAuthCodes = pgTable(
  'mcp_oauth_codes',
  {
    id: text('id').primaryKey(),
    codeHash: text('code_hash').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => mcpOAuthClients.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    redirectUri: text('redirect_uri').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    scope: text('scope').$type<McpScope>().notNull(),
    resource: text('resource').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** The connection the code was exchanged for: a second use of the code revokes it. */
    grantId: text('grant_id').references(() => mcpOAuthGrants.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('mcp_oauth_codes_client_id_idx').on(t.clientId),
    index('mcp_oauth_codes_grant_id_idx').on(t.grantId),
    index('mcp_oauth_codes_expires_at_idx').on(t.expiresAt),
  ],
);

/** Rotating refresh tokens (hashed): each is used once; `used_at` marks it for reuse detection. */
export const mcpOAuthRefreshTokens = pgTable(
  'mcp_oauth_refresh_tokens',
  {
    id: text('id').primaryKey(),
    grantId: text('grant_id')
      .notNull()
      .references(() => mcpOAuthGrants.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
  },
  (t) => [index('mcp_oauth_refresh_tokens_grant_id_idx').on(t.grantId)],
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
