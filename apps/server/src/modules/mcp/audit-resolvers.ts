import { inArray } from 'drizzle-orm';
import { registerAuditResolver } from '../audit/resolvers.js';
import { mcpOAuthGrants, mcpTokens } from './schema.js';

/**
 * The live-record resolvers of `mcp_token` and `oauth_connection`: a row
 * still exists. There is nothing to open for them on the page, but a deleted one shows as such.
 */
export function registerMcpAuditResolvers(): void {
  registerAuditResolver('mcp_token', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: mcpTokens.id })
        .from(mcpTokens)
        .where(inArray(mcpTokens.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
  registerAuditResolver('oauth_connection', {
    async existingIds(db, ids) {
      const rows = await db
        .select({ id: mcpOAuthGrants.id })
        .from(mcpOAuthGrants)
        .where(inArray(mcpOAuthGrants.id, ids));
      return new Set(rows.map((r) => r.id));
    },
  });
}
