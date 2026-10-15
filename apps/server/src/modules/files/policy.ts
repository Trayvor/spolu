import type { SessionUser } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';

/** A file is read by whoever reads its group; `actorGroupId` comes from `getMembershipGroupId`. */
export function canReadFile(
  actor: SessionUser,
  file: { groupId: string },
  actorGroupId: string | null,
): boolean {
  return canReadGroup(actor, file.groupId, actorGroupId);
}

/** Only the uploader sets the preview of a file. */
export function canSetPreview(actor: SessionUser, file: { uploadedBy: string }): boolean {
  return actor.id === file.uploadedBy;
}
