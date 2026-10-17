import type { SessionUser } from '@spolu/shared';
import { canSeeFinance } from '../finance/policy.js';
import { canReadGroup } from '../groups/policy.js';
import { isAdmin } from '../users/policy.js';

/**
 * A finance file (`financeOnly`, Phase 32) is read by finance admins only, checked first: no
 * group rule and no registered read rule opens it. Otherwise a file is read by whoever reads its
 * group, except a file of an admins-only knowledge item (`adminsOnly`), which only admins read.
 * A file of no group (sent to the intake for a ticket without a client) is read by admins only.
 * `actorGroupIds` comes from `clientGroupIds`.
 */
export function canReadFile(
  actor: SessionUser,
  file: { groupId: string | null; adminsOnly: boolean; financeOnly: boolean },
  actorGroupIds: readonly string[],
): boolean {
  if (file.financeOnly) return canSeeFinance(actor);
  if (file.groupId === null) return isAdmin(actor);
  return canReadGroup(actor, file.groupId, actorGroupIds) && (!file.adminsOnly || isAdmin(actor));
}

/** Only the uploader sets the preview of a file (a received file has none). */
export function canSetPreview(actor: SessionUser, file: { uploadedBy: string | null }): boolean {
  return actor.id === file.uploadedBy;
}
