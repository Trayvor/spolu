import type { McpScope, SessionUser } from '@spolu/shared';
import { canSeeFinance } from '../finance/policy.js';
import { isAdmin } from '../users/policy.js';

/**
 * Who may make MCP tokens and call `/mcp` (v1, spec §2 #4): admins and the superadmin. Every
 * tool then acts through the HTTP routes as that user, so this is not the only check.
 */
export function canUseMcp(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * Whether a token of `scope` may call a tool: a write tool needs a `write` token, a finance
 * documents tool the finance right (the routes check it again).
 */
export function canCallTool(
  actor: SessionUser,
  scope: McpScope,
  tool: { write?: boolean; finance?: boolean },
): boolean {
  if (tool.write && scope !== 'write') return false;
  if (tool.finance && !canSeeFinance(actor)) return false;
  return true;
}
