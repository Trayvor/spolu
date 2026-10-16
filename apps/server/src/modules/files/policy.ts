import type { SessionUser } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';
import { isAdmin } from '../users/policy.js';

/**
 * A file is read by whoever reads its group, except a file of an admins-only knowledge item
 * (`adminsOnly`), which only admins read. `actorGroupIds` comes from `clientGroupIds`.
 */
export function canReadFile(
  actor: SessionUser,
  file: { groupId: string; adminsOnly: boolean },
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, file.groupId, actorGroupIds) && (!file.adminsOnly || isAdmin(actor));
}

/** Only the uploader sets the preview of a file. */
export function canSetPreview(actor: SessionUser, file: { uploadedBy: string }): boolean {
  return actor.id === file.uploadedBy;
}
