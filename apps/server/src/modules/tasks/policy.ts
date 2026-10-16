import type { SessionUser } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';
import { isAdmin } from '../users/policy.js';

/** Read the board and create, edit and move tasks: anyone who reads the group. */
export function canUseBoard(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, groupId, actorGroupIds);
}

/** Create, rename, reorder and delete custom buckets: any admin. */
export function canManageBuckets(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** Any admin, or the client who created the task. */
export function canDeleteTask(actor: SessionUser, task: { createdBy: string }): boolean {
  return isAdmin(actor) || task.createdBy === actor.id;
}
