import type { Role, SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/** Create, edit and read all groups, logos and invite links: any admin. */
export function canManageGroups(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** Admins read every group; a client reads only the group they belong to (`actorGroupId`). */
export function canReadGroup(
  actor: SessionUser,
  groupId: string,
  actorGroupId: string | null,
): boolean {
  return isAdmin(actor) || (actor.role === 'client' && actorGroupId === groupId);
}

/** Admins remove clients; nobody removes an admin this way. */
export function canRemoveMember(actor: SessionUser, target: { role: Role }): boolean {
  return isAdmin(actor) && target.role === 'client';
}
