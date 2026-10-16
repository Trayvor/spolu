import type { SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/**
 * Every admin writes, sends, cancels and deletes any campaign (owner decision 3); clients and
 * ziadatel people never see the module.
 */
export function canUseBulkEmail(actor: SessionUser): boolean {
  return isAdmin(actor);
}
