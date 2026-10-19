import type { Role, SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/** Create, edit and read all groups, logos and invite links: any admin. */
export function canManageGroups(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * Admins read every group; a client reads the groups of their active client memberships
 * (`actorGroupIds`, from `clientGroupIds`). A ziadatel membership never opens a group.
 */
export function canReadGroup(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return isAdmin(actor) || (actor.role === 'client' && actorGroupIds.includes(groupId));
}

/** Admins remove clients; nobody removes an admin this way. */
export function canRemoveMember(actor: SessionUser, target: { role: Role }): boolean {
  return isAdmin(actor) && target.role === 'client';
}

/** Become or stop being a group's manager (self-service only): any admin. */
export function canBeManager(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** Make any active admin a group's manager, or stop them being one: any admin. */
export function canSetManager(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * Set or end an admin substitution ("Zastúpiť", 2026-10-19), for themselves or a colleague: any
 * admin.
 */
export function canManageSubstitutions(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * Who may substitute the admin `substitutedId`: another active admin (the superadmin included).
 * Whether the candidate is substituted themselves (no chains) is checked by the service.
 */
export function canBeSubstitute(
  substitutedId: string,
  candidate: { id: string; role: Role; disabledAt: Date | null } | undefined,
): boolean {
  return (
    candidate !== undefined &&
    candidate.id !== substitutedId &&
    candidate.role !== 'client' &&
    candidate.disabledAt === null
  );
}
