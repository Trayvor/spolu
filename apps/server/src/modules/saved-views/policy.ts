import type { SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/**
 * Saved views (F5) live on the admins' list pages (the global board, tickets and knowledge):
 * admins and the superadmin, never a client, whatever the page. Views are always the caller's
 * own; nobody reads another person's.
 */
export function canUseSavedViews(actor: SessionUser): boolean {
  return isAdmin(actor);
}
