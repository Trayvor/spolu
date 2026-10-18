import type { SavedViewPage, SessionUser } from '@spolu/shared';
import { canSeeFinance } from '../finance/policy.js';
import { isAdmin } from '../users/policy.js';

/**
 * Saved views (F5) live on the admins' list pages (the global board, tickets, knowledge and
 * `/finance`): admins and the superadmin, never a client. The finance page's views also need the
 * finance right (`canSeeFinance`), as the page does. Without `page` (deleting one's own view):
 * any admin. Views are always the caller's own; nobody reads another person's.
 */
export function canUseSavedViews(actor: SessionUser, page?: SavedViewPage): boolean {
  if (!isAdmin(actor)) return false;
  return page === 'finance' ? canSeeFinance(actor) : true;
}
