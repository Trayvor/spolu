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
