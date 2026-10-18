import { z } from 'zod';

/**
 * MCP server (2026-10-18, docs/superpowers/specs/2026-10-18-mcp-server-design.md): personal
 * access tokens an admin makes on `/settings` for an AI client, and the audit log of the AI's
 * write calls. The token itself is shown once and never stored (only its SHA-256 hash).
 */

export const McpScopes = ['read', 'write'] as const;
export const McpScopeSchema = z.enum(McpScopes);
export type McpScope = z.infer<typeof McpScopeSchema>;

/** How long a new token is valid; there is no token without an expiry. */
export const MCP_EXPIRY_DAYS = [7, 30, 90, 365] as const;
export const MCP_DEFAULT_EXPIRY_DAYS = 90;

export const MCP_LIMITS = {
  name: 60,
  /** Active (not revoked, not expired) tokens per user. */
  activeTokens: 10,
  /** Audit entries `GET /api/me/mcp/audit` returns. */
  auditPage: 50,
} as const;

/** Every token starts with this, so a leaked one is easy to recognise (and to scan for). */
export const MCP_TOKEN_PREFIX = 'spolu_mcp_';

/** `POST /api/me/mcp/tokens`. */
export const McpTokenCreateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(MCP_LIMITS.name),
    scope: McpScopeSchema,
    expiresInDays: z
      .number()
      .int()
      .refine((v) => (MCP_EXPIRY_DAYS as readonly number[]).includes(v)),
  })
  .strict();
export type McpTokenCreateBody = z.infer<typeof McpTokenCreateBodySchema>;

/** A token as its owner sees it in the list: never the secret, only its first characters. */
export const McpTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** The first characters of the token, e.g. `spolu_mcp_Ab3d`. */
  prefix: z.string(),
  scope: McpScopeSchema,
  createdAt: z.string(),
  expiresAt: z.string(),
  lastUsedAt: z.string().nullable(),
  expired: z.boolean(),
});
export type McpToken = z.infer<typeof McpTokenSchema>;
export const McpTokenListSchema = z.array(McpTokenSchema);

/** The answer of a create: the secret (shown once) and the list row. */
export const McpTokenCreatedSchema = z.object({ token: z.string(), item: McpTokenSchema });
export type McpTokenCreated = z.infer<typeof McpTokenCreatedSchema>;

/** One write call of the AI: which tool, on what, and how it ended; never the content. */
export const McpAuditEntrySchema = z.object({
  id: z.string(),
  tool: z.string(),
  targetId: z.string().nullable(),
  ok: z.boolean(),
  /** The HTTP status of the route the tool called (403 for a refused call). */
  status: z.number().int(),
  createdAt: z.string(),
  /** The token's name, or null once the token is gone. */
  tokenName: z.string().nullable(),
});
export type McpAuditEntry = z.infer<typeof McpAuditEntrySchema>;
export const McpAuditListSchema = z.array(McpAuditEntrySchema);

/**
 * OAuth for the MCP server (2026-10-18, docs/superpowers/specs/2026-10-18-mcp-oauth-design.md,
 * ADR 0034): an AI client such as Claude registers itself, an admin approves it on the consent
 * screen, and the client gets short-lived access tokens that work like personal tokens.
 */
export const MCP_OAUTH_LIMITS = {
  /** Active connections (approved, not revoked, not expired) per user. */
  activeConnections: 10,
  clientName: 100,
} as const;

/** The query of `/oauth/authorize`, as the consent page passes it on to the API. */
export const McpAuthorizeParamsSchema = z.object({
  response_type: z.string().max(50).optional(),
  client_id: z.string().max(200).optional(),
  redirect_uri: z.string().max(2000).optional(),
  state: z.string().max(1000).optional(),
  scope: z.string().max(200).optional(),
  code_challenge: z.string().max(200).optional(),
  code_challenge_method: z.string().max(20).optional(),
  resource: z.string().max(2000).optional(),
});
export type McpAuthorizeParams = z.infer<typeof McpAuthorizeParamsSchema>;

/** `GET /api/oauth/authorize`: what the consent screen shows, or where to send the browser. */
export const McpConsentInfoSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('consent'),
    clientName: z.string(),
    /** The host the browser returns to (claude.ai, or localhost for a desktop client). */
    redirectHost: z.string(),
    /** The most the client asked for; `read` offers read only. */
    requestedScope: McpScopeSchema,
    /** Binds the approval to this login session and these parameters (CSRF). */
    consentToken: z.string(),
    /** The user already has the most connections: approving answers 409. */
    limitReached: z.boolean(),
  }),
  /** A bad request of a known client: the error goes back to its registered address. */
  z.object({ kind: z.literal('redirect'), redirectTo: z.string() }),
]);
export type McpConsentInfo = z.infer<typeof McpConsentInfoSchema>;

/** `POST /api/oauth/authorize`. */
export const McpConsentDecisionSchema = z
  .object({
    params: McpAuthorizeParamsSchema,
    consentToken: z.string().max(500),
    approve: z.boolean(),
    scope: McpScopeSchema,
  })
  .strict();
export type McpConsentDecision = z.infer<typeof McpConsentDecisionSchema>;
export const McpConsentResultSchema = z.object({ redirectTo: z.string() });

/** A connected OAuth client on the settings card. */
export const McpConnectionSchema = z.object({
  id: z.string(),
  clientName: z.string(),
  redirectHost: z.string(),
  scope: McpScopeSchema,
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
});
export type McpConnection = z.infer<typeof McpConnectionSchema>;
export const McpConnectionListSchema = z.array(McpConnectionSchema);
