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

/**
 * Whether `actor` may newly assign `person` to a task of a group. `person` is the user's place in
 * the group (`getGroupPeopleRoles`): undefined when they are no person of it (a client of another
 * group, a ziadatel, a disabled or unknown user). The group's clients and its managers can always
 * be assigned; an admin actor also assigns any other active admin, the superadmin included (owner
 * request 2026-10-18). A client actor cannot pick an admin who does not manage the group.
 */
export function canAssignTaskTo(
  actor: SessionUser,
  person: { isAdmin: boolean; isManager: boolean } | undefined,
): boolean {
  if (!person) return false;
  if (!person.isAdmin || person.isManager) return true;
  return isAdmin(actor);
}
