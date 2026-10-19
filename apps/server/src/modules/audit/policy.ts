import type { AuditCategory, SessionUser } from '@spolu/shared';
import { canSeeFinance } from '../finance/policy.js';
import { isAdmin } from '../users/policy.js';

/** Every admin and the superadmin read the log (owner decision 2026-10-19); nobody else. */
export function canReadAudit(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** The categories of rows the viewer may see: finance rows only with the finance right. */
export function auditCategoriesFor(actor: SessionUser): AuditCategory[] {
  return canSeeFinance(actor) ? ['general', 'finance'] : ['general'];
}
