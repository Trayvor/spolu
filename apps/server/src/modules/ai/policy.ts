import type { SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/**
 * "Otvoriť v Claude" on a ticket or task (Phase 29): admins only, on any ticket (also one
 * without a client) and any task. The prompt carries the whole chat and the requester's email.
 */
export function canOpenInClaude(actor: SessionUser): boolean {
  return isAdmin(actor);
}
