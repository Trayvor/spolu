import type { SessionUser } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';
import { isAdmin } from '../users/policy.js';

/** Read the board and create, edit and move tasks: anyone who reads the group. */
export function canUseBoard(
  actor: SessionUser,
  groupId: string,
  actorGroupId: string | null,
): boolean {
  return canReadGroup(actor, groupId, actorGroupId);
}

/** Create, rename, reorder and delete custom buckets: any admin. */
export function canManageBuckets(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** Any admin, or the client who created the task. */
export function canDeleteTask(actor: SessionUser, task: { createdBy: string }): boolean {
  return isAdmin(actor) || task.createdBy === actor.id;
}
