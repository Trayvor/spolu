import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, isNotNull, isNull, lt, notExists, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import {
  MCP_OAUTH_LIMITS,
  MCP_TOKEN_PREFIX,
  type McpAuthorizeParams,
  type McpConnection,
  type McpScope,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { toSessionUser } from '../auth/session.js';
import { user } from '../users/schema.js';
import { canUseMcp } from './policy.js';
import {
  mcpOAuthClients,
  mcpOAuthCodes,
  mcpOAuthGrants,
  mcpOAuthRefreshTokens,
  mcpTokens,
} from './schema.js';

/**
 * OAuth 2.1 for the MCP server (ADR 0034, spec 2026-10-18-mcp-oauth-design.md): Help is its own
 * authorization server. A client registers itself (RFC 7591), an admin approves it on the consent
 * screen, the client exchanges the code with PKCE S256 for a one-hour access token and a rotating
 * 30-day refresh token. The access token is an `mcp_tokens` row (`oauth_grant_id` set), so `/mcp`
 * authenticates, scopes, rate-limits and audits it exactly like a personal token.
 */

export const OAUTH_TTL = {
  codeMs: 120_000,
  accessMs: 3_600_000,
  refreshMs: 30 * 86_400_000,
  consentMs: 15 * 60_000,
  /** A registered client never used is deleted after a day, one no longer used after 30 days. */
  unusedClientMs: 86_400_000,
  idleClientMs: 30 * 86_400_000,
} as const;

/** All registered clients at most; the stale ones are deleted first. */
export const MAX_CLIENTS = 500;
export const REFRESH_TOKEN_PREFIX = 'spolu_mcr_';

/**
 * Redirect addresses a client may register (decision in ADR 0034): https on Claude's own hosts
 * (claude.ai, claude.com; exactly these hosts, no subdomain), and http on the loopback for a
 * desktop client (RFC 8252). Nothing else, so a code can only ever reach Claude or the user's
 * own machine, and a self-declared name ("Claude") cannot send it anywhere else.
 */
export const ALLOWED_REDIRECT_HOSTS = ['claude.ai', 'claude.com'] as const;
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export class OAuthError extends Error {
  constructor(
    readonly status: number,
    readonly error: string,
    readonly description?: string,
  ) {
    super(error);
  }
}

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The issuer and the one protected resource, from `PUBLIC_URL`. */
export function oauthUrls(publicUrl: string) {
  const issuer = new URL(publicUrl).origin;
  return { issuer, resource: `${issuer}/mcp` };
}

// ---------------------------------------------------------------- redirect addresses

export function isAllowedRedirectUri(raw: string): boolean {
  if (raw.length > 500 || /[\\\s#]/.test(raw)) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  if (url.protocol === 'https:') {
    return (ALLOWED_REDIRECT_HOSTS as readonly string[]).includes(url.hostname) && url.port === '';
  }
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(url.hostname);
  return false;
}

const isLoopback = (url: URL) => url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);

/**
 * The registered address the request names: an exact match, or a loopback one that differs only
 * in the port (RFC 8252 §7.3: a desktop client picks a free port each time). Null otherwise.
 */
export function matchRedirectUri(registered: string[], given: string | undefined): string | null {
  if (given === undefined) return registered.length === 1 ? registered[0]! : null;
  if (registered.includes(given)) return given;
  if (!isAllowedRedirectUri(given)) return null;
  const asked = new URL(given);
  if (!isLoopback(asked)) return null;
  const withoutPort = (url: URL) => `${url.protocol}//${url.hostname}${url.pathname}${url.search}`;
  return registered.some((uri) => {
    const known = new URL(uri);
    return isLoopback(known) && withoutPort(known) === withoutPort(asked);
  })
    ? given
    : null;
}

/** The registered address with the answer's parameters added (never any other address). */
function redirectTo(uri: string, values: Record<string, string | undefined>): string {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  return url.toString();
}

// ---------------------------------------------------------------- registration (RFC 7591)

const AUTH_METHODS = ['none', 'client_secret_post', 'client_secret_basic'] as const;
type AuthMethod = (typeof AUTH_METHODS)[number];
const GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;

const RegistrationSchema = z
  .object({
    redirect_uris: z.array(z.string()).min(1).max(5),
    client_name: z.string().max(500).optional(),
    // RFC 7591 §2: the default is client_secret_basic.
    token_endpoint_auth_method: z.enum(AUTH_METHODS).default('client_secret_basic'),
    grant_types: z.array(z.enum(GRANT_TYPES)).min(1).optional(),
    response_types: z.array(z.literal('code')).min(1).optional(),
  })
  .loose();

export type RegisteredClient = {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: AuthMethod;
  client_secret?: string;
  client_secret_expires_at?: number;
};

/** Deletes clients without an active connection: never used for a day, or idle for 30 days. */
async function deleteStaleClients(db: Db, now: Date): Promise<void> {
  const neverUsedBefore = new Date(now.getTime() - OAUTH_TTL.unusedClientMs);
  const idleBefore = new Date(now.getTime() - OAUTH_TTL.idleClientMs);
  await db
    .delete(mcpOAuthClients)
    .where(
      and(
        or(
          and(isNull(mcpOAuthClients.lastUsedAt), lt(mcpOAuthClients.createdAt, neverUsedBefore)),
          lt(mcpOAuthClients.lastUsedAt, idleBefore),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(mcpOAuthGrants)
            .where(
              and(
                eq(mcpOAuthGrants.clientId, mcpOAuthClients.id),
                isNull(mcpOAuthGrants.revokedAt),
                gt(mcpOAuthGrants.expiresAt, now),
              ),
            ),
        ),
      ),
    );
}

export async function registerClient(db: Db, body: unknown): Promise<RegisteredClient> {
  const parsed = RegistrationSchema.safeParse(body);
  if (!parsed.success) {
    const badUris = parsed.error.issues.some((issue) => issue.path[0] === 'redirect_uris');
    throw new OAuthError(400, badUris ? 'invalid_redirect_uri' : 'invalid_client_metadata');
  }
  const data = parsed.data;
  if (!data.redirect_uris.every(isAllowedRedirectUri)) {
    throw new OAuthError(
      400,
      'invalid_redirect_uri',
      `Only https://${ALLOWED_REDIRECT_HOSTS.join(', https://')} and http loopback addresses are accepted.`,
    );
  }
  const name =
    (data.client_name ?? '')
      .replace(/\p{Cc}/gu, '')
      .trim()
      .slice(0, MCP_OAUTH_LIMITS.clientName) || 'MCP client';
  const now = new Date();
  await deleteStaleClients(db, now);
  const [total] = await db.select({ n: count() }).from(mcpOAuthClients);
  if ((total?.n ?? 0) >= MAX_CLIENTS) throw new OAuthError(503, 'temporarily_unavailable');

  const id = `mcpc_${randomBytes(16).toString('base64url')}`;
  const method = data.token_endpoint_auth_method;
  const clientSecret = method === 'none' ? undefined : secret();
  await db.insert(mcpOAuthClients).values({
    id,
    secretHash: clientSecret ? hash(clientSecret) : null,
    authMethod: method,
    name,
    redirectUris: data.redirect_uris,
    createdAt: now,
  });
  return {
    client_id: id,
    client_id_issued_at: Math.floor(now.getTime() / 1000),
    client_name: name,
    redirect_uris: data.redirect_uris,
    grant_types: [...GRANT_TYPES],
    response_types: ['code'],
    token_endpoint_auth_method: method,
    ...(clientSecret ? { client_secret: clientSecret, client_secret_expires_at: 0 } : {}),
  };
}

type ClientRow = typeof mcpOAuthClients.$inferSelect;

/**
 * The client of a token or revocation request: `client_id` (and `client_secret`) in the body,
 * or HTTP Basic. A client registered with a secret must send it. `invalid_client` (401) otherwise.
 */
export async function authenticateClient(
  db: Db,
  body: Record<string, unknown>,
  authorization: string | undefined,
): Promise<ClientRow> {
  let id = typeof body.client_id === 'string' ? body.client_id : undefined;
  let given = typeof body.client_secret === 'string' ? body.client_secret : undefined;
  const basic = /^Basic ([A-Za-z0-9+/=]+)$/i.exec(authorization ?? '')?.[1];
  if (basic) {
    const decoded = Buffer.from(basic, 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon > 0) {
      try {
        id = decodeURIComponent(decoded.slice(0, colon));
        given = decodeURIComponent(decoded.slice(colon + 1));
      } catch {
        throw new OAuthError(401, 'invalid_client');
      }
    }
  }
  if (!id || id.length > 200) throw new OAuthError(401, 'invalid_client');
  const [client] = await db.select().from(mcpOAuthClients).where(eq(mcpOAuthClients.id, id));
  if (!client) throw new OAuthError(401, 'invalid_client');
  if (client.secretHash !== null) {
    if (!given || given.length > 200 || !safeEqual(hash(given), client.secretHash)) {
      throw new OAuthError(401, 'invalid_client');
    }
  }
  return client;
}

// ---------------------------------------------------------------- authorization request

const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

/** The scope a space-separated `scope` asks for at most; null for an unknown value. */
export function parseScope(raw: string | undefined): McpScope | null {
  const values = (raw ?? '').split(' ').filter(Boolean);
  if (values.some((v) => v !== 'read' && v !== 'write')) return null;
  return values.length === 0 || values.includes('write') ? 'write' : 'read';
}

export const scopeString = (scope: McpScope) => (scope === 'write' ? 'read write' : 'read');

export type AuthorizeCheck =
  | {
      kind: 'ok';
      client: ClientRow;
      redirectUri: string;
      maxScope: McpScope;
      challenge: string;
      state: string | undefined;
      resource: string;
    }
  /** No client or no registered address: shown on the page, never redirected anywhere. */
  | { kind: 'refuse'; error: 'invalid_client' | 'invalid_redirect_uri' }
  /** A known client and address: the error goes back there. */
  | { kind: 'redirect'; redirectTo: string };

export async function checkAuthorizeRequest(
  db: Db,
  publicUrl: string,
  params: McpAuthorizeParams,
): Promise<AuthorizeCheck> {
  const { issuer, resource } = oauthUrls(publicUrl);
  if (!params.client_id) return { kind: 'refuse', error: 'invalid_client' };
  const [client] = await db
    .select()
    .from(mcpOAuthClients)
    .where(eq(mcpOAuthClients.id, params.client_id));
  if (!client) return { kind: 'refuse', error: 'invalid_client' };
  const redirectUri = matchRedirectUri(client.redirectUris, params.redirect_uri);
  if (!redirectUri) return { kind: 'refuse', error: 'invalid_redirect_uri' };

  const back = (error: string, description?: string) => ({
    kind: 'redirect' as const,
    redirectTo: redirectTo(redirectUri, {
      error,
      error_description: description,
      state: params.state,
      iss: issuer,
    }),
  });
  if (params.response_type !== 'code') return back('unsupported_response_type');
  if (!params.code_challenge || !CHALLENGE.test(params.code_challenge)) {
    return back('invalid_request', 'PKCE code_challenge (S256) is required');
  }
  if (params.code_challenge_method !== 'S256') {
    return back('invalid_request', 'code_challenge_method must be S256');
  }
  if (params.resource !== undefined && params.resource !== resource) {
    return back('invalid_target', `the resource is ${resource}`);
  }
  const maxScope = parseScope(params.scope);
  if (!maxScope) return back('invalid_scope', 'scopes are read and write');
  return {
    kind: 'ok',
    client,
    redirectUri,
    maxScope,
    challenge: params.code_challenge,
    state: params.state,
    resource,
  };
}

// ---------------------------------------------------------------- consent

const PARAM_KEYS = [
  'response_type',
  'client_id',
  'redirect_uri',
  'state',
  'scope',
  'code_challenge',
  'code_challenge_method',
  'resource',
] as const;

function consentMac(appSecret: string, sessionId: string, params: McpAuthorizeParams, exp: number) {
  const fields = PARAM_KEYS.map((key) => `${key}=${params[key] ?? ''}`);
  return createHmac('sha256', appSecret)
    .update(['mcp-consent', sessionId, String(exp), ...fields].join('\n'))
    .digest('base64url');
}

/**
 * A consent token: binds an approval to the login session that saw the consent screen and to
 * exactly these parameters, for 15 minutes. A page on another site cannot read it, so it cannot
 * post an approval (CSRF), on top of the `/api` Origin check and the SameSite cookie.
 */
export function makeConsentToken(
  appSecret: string,
  sessionId: string,
  params: McpAuthorizeParams,
  now = Date.now(),
): string {
  const exp = now + OAUTH_TTL.consentMs;
  return `${exp}.${consentMac(appSecret, sessionId, params, exp)}`;
}

export function verifyConsentToken(
  appSecret: string,
  sessionId: string,
  params: McpAuthorizeParams,
  token: string,
  now = Date.now(),
): boolean {
  const [expRaw, mac] = token.split('.');
  const exp = Number(expRaw);
  if (!mac || !Number.isSafeInteger(exp) || exp < now) return false;
  return safeEqual(mac, consentMac(appSecret, sessionId, params, exp));
}

const activeGrant = (now: Date) =>
  and(isNull(mcpOAuthGrants.revokedAt), gt(mcpOAuthGrants.expiresAt, now));

export async function countActiveConnections(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(mcpOAuthGrants)
    .where(and(eq(mcpOAuthGrants.userId, userId), activeGrant(new Date())));
  return row?.n ?? 0;
}

export class ConnectionLimitError extends Error {}

/**
 * The user approved: a single-use code for two minutes, bound to the client, the address, the
 * PKCE challenge, the scope and the resource. Returns the address to send the browser to.
 */
export async function approve(
  db: Db,
  publicUrl: string,
  actor: SessionUser,
  check: Extract<AuthorizeCheck, { kind: 'ok' }>,
  scope: McpScope,
): Promise<string> {
  if (check.maxScope === 'read' && scope === 'write') {
    throw new OAuthError(400, 'invalid_scope');
  }
  if ((await countActiveConnections(db, actor.id)) >= MCP_OAUTH_LIMITS.activeConnections) {
    throw new ConnectionLimitError();
  }
  const now = new Date();
  // Codes are only looked at again for reuse detection; an hour after expiry they can go.
  await db
    .delete(mcpOAuthCodes)
    .where(lt(mcpOAuthCodes.expiresAt, new Date(now.getTime() - 3_600_000)));
  const code = secret();
  await db.insert(mcpOAuthCodes).values({
    id: randomUUID(),
    codeHash: hash(code),
    clientId: check.client.id,
    userId: actor.id,
    redirectUri: check.redirectUri,
    codeChallenge: check.challenge,
    scope,
    resource: check.resource,
    createdAt: now,
    expiresAt: new Date(now.getTime() + OAUTH_TTL.codeMs),
  });
  return redirectTo(check.redirectUri, {
    code,
    state: check.state,
    iss: oauthUrls(publicUrl).issuer,
  });
}

/** The user said no: `access_denied` back to the client's registered address. */
export function deny(publicUrl: string, check: Extract<AuthorizeCheck, { kind: 'ok' }>): string {
  return redirectTo(check.redirectUri, {
    error: 'access_denied',
    state: check.state,
    iss: oauthUrls(publicUrl).issuer,
  });
}

// ---------------------------------------------------------------- tokens

export type TokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
};

const str = (body: Record<string, unknown>, key: string) => {
  const value = body[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
};

/** The user re-read, as a session is: null unless still an active admin (`canUseMcp`). */
async function activeMcpUser(db: Db, userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      disabledAt: user.disabledAt,
      financeAccessAt: user.financeAccessAt,
    })
    .from(user)
    .where(eq(user.id, userId));
  const sessionUser = toSessionUser(row);
  return sessionUser && canUseMcp(sessionUser) ? sessionUser : null;
}

/** Ends a connection: no more refresh, and its access token stops at once. */
export async function revokeGrantById(db: Db, grantId: string): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .update(mcpOAuthGrants)
      .set({ revokedAt: now })
      .where(and(eq(mcpOAuthGrants.id, grantId), isNull(mcpOAuthGrants.revokedAt)));
    await tx
      .update(mcpTokens)
      .set({ revokedAt: now })
      .where(and(eq(mcpTokens.oauthGrantId, grantId), isNull(mcpTokens.revokedAt)));
  });
}

function newAccessToken() {
  const token = MCP_TOKEN_PREFIX + secret();
  return { token, hash: hash(token), prefix: token.slice(0, MCP_TOKEN_PREFIX.length + 4) };
}

/** `grant_type=authorization_code` (with PKCE). */
export async function exchangeCode(
  db: Db,
  publicUrl: string,
  client: ClientRow,
  body: Record<string, unknown>,
): Promise<TokenResponse> {
  const code = str(body, 'code');
  const verifier = str(body, 'code_verifier');
  const redirectUri = str(body, 'redirect_uri');
  if (!code || !verifier || !redirectUri) {
    throw new OAuthError(400, 'invalid_request', 'code, code_verifier and redirect_uri are required');
  }
  const now = new Date();
  const codeHash = hash(code);
  // Claimed first, atomically: a code is used up by its first exchange, also a failed one.
  const [row] = await db
    .update(mcpOAuthCodes)
    .set({ usedAt: now })
    .where(and(eq(mcpOAuthCodes.codeHash, codeHash), isNull(mcpOAuthCodes.usedAt)))
    .returning();
  if (!row) {
    // A second use: whoever holds the code is not to be trusted with what the first one gave.
    const [used] = await db
      .select({ grantId: mcpOAuthCodes.grantId })
      .from(mcpOAuthCodes)
      .where(eq(mcpOAuthCodes.codeHash, codeHash));
    if (used?.grantId) await revokeGrantById(db, used.grantId);
    throw new OAuthError(400, 'invalid_grant');
  }
  if (row.clientId !== client.id || row.expiresAt <= now || row.redirectUri !== redirectUri) {
    throw new OAuthError(400, 'invalid_grant');
  }
  const resource = str(body, 'resource');
  if (resource !== undefined && resource !== row.resource) {
    throw new OAuthError(400, 'invalid_target');
  }
  if (!VERIFIER.test(verifier)) throw new OAuthError(400, 'invalid_grant');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  if (!safeEqual(challenge, row.codeChallenge)) throw new OAuthError(400, 'invalid_grant');
  if (!(await activeMcpUser(db, row.userId))) throw new OAuthError(400, 'invalid_grant');

  const access = newAccessToken();
  const refreshToken = REFRESH_TOKEN_PREFIX + secret();
  const grantId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(mcpOAuthGrants).values({
      id: grantId,
      clientId: client.id,
      userId: row.userId,
      scope: row.scope,
      redirectUri: row.redirectUri,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_TTL.refreshMs),
    });
    await tx.insert(mcpTokens).values({
      id: randomUUID(),
      userId: row.userId,
      name: client.name.slice(0, 60),
      tokenHash: access.hash,
      prefix: access.prefix,
      scope: row.scope,
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_TTL.accessMs),
      oauthGrantId: grantId,
    });
    await tx.insert(mcpOAuthRefreshTokens).values({
      id: randomUUID(),
      grantId,
      tokenHash: hash(refreshToken),
      createdAt: now,
      expiresAt: new Date(now.getTime() + OAUTH_TTL.refreshMs),
    });
    await tx.update(mcpOAuthCodes).set({ grantId }).where(eq(mcpOAuthCodes.id, row.id));
    await tx.update(mcpOAuthClients).set({ lastUsedAt: now }).where(eq(mcpOAuthClients.id, client.id));
  });
  return {
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: OAUTH_TTL.accessMs / 1000,
    refresh_token: refreshToken,
    scope: scopeString(row.scope),
  };
}

/**
 * `grant_type=refresh_token`: rotates. The refresh token is used up, a new one and a new access
 * token are issued (the old access token stops). A used refresh token presented again means a
 * copy exists: the whole connection is revoked (reuse detection, OAuth 2.1 §4.3.1).
 */
export async function refreshTokens(
  db: Db,
  client: ClientRow,
  body: Record<string, unknown>,
): Promise<TokenResponse> {
  const raw = str(body, 'refresh_token');
  if (!raw) throw new OAuthError(400, 'invalid_request', 'refresh_token is required');
  if (!raw.startsWith(REFRESH_TOKEN_PREFIX) || raw.length > 200) {
    throw new OAuthError(400, 'invalid_grant');
  }
  const now = new Date();
  const tokenHash = hash(raw);
  const [found] = await db
    .select({
      id: mcpOAuthRefreshTokens.id,
      usedAt: mcpOAuthRefreshTokens.usedAt,
      expiresAt: mcpOAuthRefreshTokens.expiresAt,
      grantId: mcpOAuthGrants.id,
      clientId: mcpOAuthGrants.clientId,
      userId: mcpOAuthGrants.userId,
      scope: mcpOAuthGrants.scope,
      revokedAt: mcpOAuthGrants.revokedAt,
    })
    .from(mcpOAuthRefreshTokens)
    .innerJoin(mcpOAuthGrants, eq(mcpOAuthGrants.id, mcpOAuthRefreshTokens.grantId))
    .where(eq(mcpOAuthRefreshTokens.tokenHash, tokenHash));
  // Another client's token is not this client's to use, nor to burn.
  if (!found || found.clientId !== client.id) throw new OAuthError(400, 'invalid_grant');
  if (found.usedAt) {
    await revokeGrantById(db, found.grantId);
    throw new OAuthError(400, 'invalid_grant');
  }
  if (found.revokedAt || found.expiresAt <= now) throw new OAuthError(400, 'invalid_grant');
  const asked = str(body, 'scope');
  if (asked !== undefined) {
    const wanted = parseScope(asked);
    if (!wanted || (wanted === 'write' && found.scope === 'read')) {
      throw new OAuthError(400, 'invalid_scope');
    }
  }
  const [claimed] = await db
    .update(mcpOAuthRefreshTokens)
    .set({ usedAt: now })
    .where(and(eq(mcpOAuthRefreshTokens.id, found.id), isNull(mcpOAuthRefreshTokens.usedAt)))
    .returning({ id: mcpOAuthRefreshTokens.id });
  if (!claimed) {
    // Two refreshes with one token at the same moment: one of them is a copy.
    await revokeGrantById(db, found.grantId);
    throw new OAuthError(400, 'invalid_grant');
  }
  if (!(await activeMcpUser(db, found.userId))) throw new OAuthError(400, 'invalid_grant');

  const access = newAccessToken();
  const refreshToken = REFRESH_TOKEN_PREFIX + secret();
  const refreshExpires = new Date(now.getTime() + OAUTH_TTL.refreshMs);
  await db.transaction(async (tx) => {
    await tx.insert(mcpOAuthRefreshTokens).values({
      id: randomUUID(),
      grantId: found.grantId,
      tokenHash: hash(refreshToken),
      createdAt: now,
      expiresAt: refreshExpires,
    });
    await tx
      .update(mcpTokens)
      .set({
        tokenHash: access.hash,
        prefix: access.prefix,
        expiresAt: new Date(now.getTime() + OAUTH_TTL.accessMs),
      })
      .where(and(eq(mcpTokens.oauthGrantId, found.grantId), isNull(mcpTokens.revokedAt)));
    await tx
      .update(mcpOAuthGrants)
      .set({ expiresAt: refreshExpires })
      .where(eq(mcpOAuthGrants.id, found.grantId));
    // Used tokens are kept for reuse detection until they would have expired anyway.
    await tx
      .delete(mcpOAuthRefreshTokens)
      .where(
        and(
          eq(mcpOAuthRefreshTokens.grantId, found.grantId),
          lt(mcpOAuthRefreshTokens.expiresAt, now),
        ),
      );
    await tx.update(mcpOAuthClients).set({ lastUsedAt: now }).where(eq(mcpOAuthClients.id, client.id));
  });
  return {
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: OAUTH_TTL.accessMs / 1000,
    refresh_token: refreshToken,
    scope: scopeString(found.scope),
  };
}

/**
 * RFC 7009: a refresh or access token of this client ends its connection. Unknown tokens and
 * other clients' tokens change nothing (the answer is the same 200 either way).
 */
export async function revokeByToken(db: Db, client: ClientRow, raw: string): Promise<void> {
  if (raw.length > 200) return;
  const tokenHash = hash(raw);
  const [viaRefresh] = await db
    .select({ grantId: mcpOAuthGrants.id, clientId: mcpOAuthGrants.clientId })
    .from(mcpOAuthRefreshTokens)
    .innerJoin(mcpOAuthGrants, eq(mcpOAuthGrants.id, mcpOAuthRefreshTokens.grantId))
    .where(eq(mcpOAuthRefreshTokens.tokenHash, tokenHash));
  const [viaAccess] = viaRefresh
    ? [viaRefresh]
    : await db
        .select({ grantId: mcpOAuthGrants.id, clientId: mcpOAuthGrants.clientId })
        .from(mcpTokens)
        .innerJoin(mcpOAuthGrants, eq(mcpOAuthGrants.id, mcpTokens.oauthGrantId))
        .where(and(eq(mcpTokens.tokenHash, tokenHash), isNotNull(mcpTokens.oauthGrantId)));
  if (viaAccess && viaAccess.clientId === client.id) await revokeGrantById(db, viaAccess.grantId);
}

// ---------------------------------------------------------------- the settings card

const hostOf = (uri: string) => {
  try {
    return new URL(uri).hostname;
  } catch {
    return uri;
  }
};

/** The user's active connections, newest first, with the client and the last use. */
export async function listConnections(db: Db, userId: string): Promise<McpConnection[]> {
  const rows = await db
    .select({
      id: mcpOAuthGrants.id,
      clientName: mcpOAuthClients.name,
      redirectUri: mcpOAuthGrants.redirectUri,
      scope: mcpOAuthGrants.scope,
      createdAt: mcpOAuthGrants.createdAt,
      lastUsedAt: mcpTokens.lastUsedAt,
    })
    .from(mcpOAuthGrants)
    .innerJoin(mcpOAuthClients, eq(mcpOAuthClients.id, mcpOAuthGrants.clientId))
    .leftJoin(mcpTokens, eq(mcpTokens.oauthGrantId, mcpOAuthGrants.id))
    .where(and(eq(mcpOAuthGrants.userId, userId), activeGrant(new Date())))
    .orderBy(desc(mcpOAuthGrants.createdAt), desc(mcpOAuthGrants.id));
  return rows.map((r) => ({
    id: r.id,
    clientName: r.clientName,
    redirectHost: hostOf(r.redirectUri),
    scope: r.scope,
    createdAt: r.createdAt.toISOString(),
    lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
  }));
}

/** Revokes one of the user's own connections; false for another user's or an unknown one. */
export async function revokeConnection(db: Db, userId: string, grantId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: mcpOAuthGrants.id })
    .from(mcpOAuthGrants)
    .where(
      and(
        eq(mcpOAuthGrants.id, grantId),
        eq(mcpOAuthGrants.userId, userId),
        isNull(mcpOAuthGrants.revokedAt),
      ),
    );
  if (!row) return false;
  await revokeGrantById(db, row.id);
  return true;
}

/** Every connection of the user (deactivation). */
export async function revokeAllConnections(db: Db, userId: string): Promise<void> {
  await db
    .update(mcpOAuthGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(mcpOAuthGrants.userId, userId), isNull(mcpOAuthGrants.revokedAt)));
}
