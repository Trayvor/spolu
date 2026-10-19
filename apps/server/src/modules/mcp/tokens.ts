import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { and, count, desc, eq, gt, isNull, lt, or } from 'drizzle-orm';
import {
  MCP_LIMITS,
  MCP_TOKEN_PREFIX,
  type McpScope,
  type McpToken,
  type McpTokenCreateBody,
  type McpTokenCreated,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { toSessionUser } from '../auth/session.js';
import { user } from '../users/schema.js';
import { revokeAllConnections } from './oauth.js';
import { mcpTokens } from './schema.js';
import type { AuditActor } from '../audit/actor.js';
import { diffFields } from '../audit/diff.js';
import { recordAudit } from '../audit/service.js';

/**
 * Personal access tokens of the MCP server (spec §3, ADR 0033): `spolu_mcp_` and 32 random
 * bytes (base64url), shown once; only the SHA-256 hash is stored. A token authenticates while it
 * is not revoked, not expired and its user is not disabled; the role is checked by the caller.
 */

export class TokenLimitError extends Error {}

const DAY_MS = 86_400_000;
/** The token's first characters kept for the owner's list. */
const PREFIX_LENGTH = MCP_TOKEN_PREFIX.length + 4;
/** A real token is 53 characters; anything far longer is refused before hashing. */
const MAX_TOKEN_LENGTH = 200;
const TOUCH_EVERY_MS = 60_000;

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

type TokenRow = typeof mcpTokens.$inferSelect;

function toDto(row: TokenRow, now = new Date()): McpToken {
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scope: row.scope,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    expired: row.expiresAt <= now,
  };
}

/** A new token of the user; `TokenLimitError` when they already have the most active ones. */
export async function createToken(
  db: Db,
  userId: string,
  body: McpTokenCreateBody,
  by?: AuditActor,
): Promise<McpTokenCreated> {
  const token = MCP_TOKEN_PREFIX + randomBytes(32).toString('base64url');
  const now = new Date();
  return db.transaction(async (tx) => {
    // Serialises the user's creates, so two at once cannot both pass the count.
    await tx.select({ id: user.id }).from(user).where(eq(user.id, userId)).for('update');
    const [active] = await tx
      .select({ n: count() })
      .from(mcpTokens)
      .where(
        and(
          eq(mcpTokens.userId, userId),
          isNull(mcpTokens.oauthGrantId),
          isNull(mcpTokens.revokedAt),
          gt(mcpTokens.expiresAt, now),
        ),
      );
    if ((active?.n ?? 0) >= MCP_LIMITS.activeTokens) throw new TokenLimitError();
    const [row] = await tx
      .insert(mcpTokens)
      .values({
        id: randomUUID(),
        userId,
        name: body.name,
        tokenHash: hashToken(token),
        prefix: token.slice(0, PREFIX_LENGTH),
        scope: body.scope,
        createdAt: now,
        expiresAt: new Date(now.getTime() + body.expiresInDays * DAY_MS),
      })
      .returning();
    // Name, scope and expiry; never the token or its hash.
    if (by) {
      await recordAudit(tx, by, [
        {
          entityType: 'mcp_token',
          entityId: row!.id,
          entityLabel: row!.name,
          groupId: null,
          action: 'created',
          changes: diffFields('mcp_token', null, {
            name: row!.name,
            scope: row!.scope,
            expiresAt: row!.expiresAt,
          }),
        },
      ]);
    }
    return { token, item: toDto(row!, now) };
  });
}

/**
 * The user's personal tokens that are not revoked (expired ones too, marked), newest first. The
 * access tokens of OAuth connections are listed as connections (`oauth.ts`), not here.
 */
export async function listTokens(db: Db, userId: string): Promise<McpToken[]> {
  const rows = await db
    .select()
    .from(mcpTokens)
    .where(
      and(
        eq(mcpTokens.userId, userId),
        isNull(mcpTokens.oauthGrantId),
        isNull(mcpTokens.revokedAt),
      ),
    )
    .orderBy(desc(mcpTokens.createdAt), desc(mcpTokens.id));
  const now = new Date();
  return rows.map((row) => toDto(row, now));
}

/** Revokes one of the user's own tokens; false for another user's, an unknown or a revoked one. */
export async function revokeToken(
  db: Db,
  userId: string,
  tokenId: string,
  by?: AuditActor,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const rows = await tx
      .update(mcpTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(mcpTokens.id, tokenId),
          eq(mcpTokens.userId, userId),
          isNull(mcpTokens.oauthGrantId),
          isNull(mcpTokens.revokedAt),
        ),
      )
      .returning({ id: mcpTokens.id, name: mcpTokens.name });
    if (by)
      await recordAudit(
        tx,
        by,
        rows.map((r) => tokenRevoked(r)),
      );
    return rows.length > 0;
  });
}

const tokenRevoked = (r: { id: string; name: string }, causeId: string | null = null) => ({
  entityType: 'mcp_token' as const,
  entityId: r.id,
  entityLabel: r.name,
  groupId: null,
  action: 'revoked' as const,
  causeId,
});

/**
 * Revokes every token and every OAuth connection of the user (deactivation: an admin added back
 * needs new tokens and connects again).
 */
export async function revokeAllTokens(
  db: Db,
  userId: string,
  consequence?: { by: AuditActor; causeId: string },
): Promise<void> {
  await revokeAllConnections(db, userId, consequence);
  const rows = await db
    .update(mcpTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id, name: mcpTokens.name, oauthGrantId: mcpTokens.oauthGrantId });
  if (consequence) {
    // A connection's access token is its connection's row (above), not a token of its own.
    await recordAudit(
      db,
      consequence.by,
      rows.filter((r) => r.oauthGrantId === null).map((r) => tokenRevoked(r, consequence.causeId)),
    );
  }
}

/** `tokenName`: the token's (or the OAuth connection's) name, for the audit log's author. */
export type TokenAuth = { tokenId: string; tokenName: string; scope: McpScope; user: SessionUser };

/**
 * The user behind a raw token, read fresh (role, disabled, finance right) as a session is; null
 * for a malformed, unknown, revoked or expired token and for a disabled user. Notes the use at
 * most once a minute.
 */
export async function authenticateToken(db: Db, raw: string): Promise<TokenAuth | null> {
  if (!raw.startsWith(MCP_TOKEN_PREFIX) || raw.length > MAX_TOKEN_LENGTH) return null;
  const now = new Date();
  const [row] = await db
    .select({
      tokenId: mcpTokens.id,
      tokenName: mcpTokens.name,
      scope: mcpTokens.scope,
      lastUsedAt: mcpTokens.lastUsedAt,
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      disabledAt: user.disabledAt,
      financeAccessAt: user.financeAccessAt,
    })
    .from(mcpTokens)
    .innerJoin(user, eq(user.id, mcpTokens.userId))
    .where(
      and(
        eq(mcpTokens.tokenHash, hashToken(raw)),
        isNull(mcpTokens.revokedAt),
        gt(mcpTokens.expiresAt, now),
      ),
    );
  if (!row) return null;
  const sessionUser = toSessionUser(row);
  if (!sessionUser) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= TOUCH_EVERY_MS) {
    const stale = new Date(now.getTime() - TOUCH_EVERY_MS);
    await db
      .update(mcpTokens)
      .set({ lastUsedAt: now })
      .where(
        and(
          eq(mcpTokens.id, row.tokenId),
          or(isNull(mcpTokens.lastUsedAt), lt(mcpTokens.lastUsedAt, stale)),
        ),
      );
  }
  return { tokenId: row.tokenId, tokenName: row.tokenName, scope: row.scope, user: sessionUser };
}
