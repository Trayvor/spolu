import type { McpScope, SessionUser } from '@spolu/shared';
import { canSeeFinance } from '../finance/policy.js';
import { isAdmin } from '../users/policy.js';

/**
 * Who may make MCP tokens, connect an assistant and call `/mcp` (ADR 0071, amending spec §2 #4):
 * admins and the superadmin, and a client while they are a manager of at least one client
 * (`clientGroups`: their active `client` memberships of live groups). A pure žiadateľ never.
 * Every tool then acts through the HTTP routes as that user, so this is not the only check.
 */
export function canUseMcp(actor: SessionUser, clientGroups: number): boolean {
  if (isAdmin(actor)) return true;
  return actor.role === 'client' && clientGroups > 0;
}

/**
 * Whether a token of `scope` may call a tool: a write tool needs a `write` token, a finance
 * tool (every finance entity, owner decision 2026-10-18) the finance right (the routes check it
 * again), an admin tool (ADR 0071: its routes refuse clients) an admin.
 */
export function canCallTool(
  actor: SessionUser,
  scope: McpScope,
  tool: { write?: boolean; finance?: boolean; admin?: boolean },
): boolean {
  if (tool.write && scope !== 'write') return false;
  if (tool.finance && !canSeeFinance(actor)) return false;
  if (tool.admin && !isAdmin(actor)) return false;
  return true;
}
