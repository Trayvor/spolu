import { queryOptions } from '@tanstack/react-query';
import {
  McpAuditListSchema,
  McpTokenCreatedSchema,
  McpTokenListSchema,
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
