import { queryOptions } from '@tanstack/react-query';
import {
  McpAuditListSchema,
  McpConnectionListSchema,
  McpConsentInfoSchema,
  McpConsentResultSchema,
  McpTokenCreatedSchema,
  McpTokenListSchema,
  type McpAuthorizeParams,
  type McpConsentDecision,
  type McpConsentInfo,
  type McpTokenCreateBody,
  type McpTokenCreated,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** The signed-in admin's own MCP tokens (revoked ones are left out). */
export const mcpTokensQuery = queryOptions({
  queryKey: ['me', 'mcp', 'tokens'],
  queryFn: () => apiGet('/me/mcp/tokens', McpTokenListSchema),
});

/** The admin's own last write calls made through MCP. */
export const mcpAuditQuery = queryOptions({
  queryKey: ['me', 'mcp', 'audit'],
  queryFn: () => apiGet('/me/mcp/audit', McpAuditListSchema),
});

export function createMcpToken(body: McpTokenCreateBody): Promise<McpTokenCreated> {
  return apiSend('POST', '/me/mcp/tokens', body, McpTokenCreatedSchema);
}

export async function revokeMcpToken(id: string): Promise<void> {
  await apiSend('DELETE', `/me/mcp/tokens/${encodeURIComponent(id)}`);
}

/** The admin's connected OAuth clients (Claude custom connectors, ADR 0034). */
export const mcpConnectionsQuery = queryOptions({
  queryKey: ['me', 'mcp', 'connections'],
  queryFn: () => apiGet('/me/mcp/connections', McpConnectionListSchema),
});

export async function revokeMcpConnection(id: string): Promise<void> {
  await apiSend('DELETE', `/me/mcp/connections/${encodeURIComponent(id)}`);
}

/** What the consent screen shows for these `/oauth/authorize` parameters. */
export function getConsentInfo(params: McpAuthorizeParams): Promise<McpConsentInfo> {
  const query = new URLSearchParams(params as Record<string, string>).toString();
  return apiGet(`/oauth/authorize?${query}`, McpConsentInfoSchema);
}

export function decideConsent(body: McpConsentDecision): Promise<{ redirectTo: string }> {
  return apiSend('POST', '/oauth/authorize', body, McpConsentResultSchema);
}
