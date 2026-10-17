import type { MemberRole, SessionUser } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';
import { canUseBoard } from '../tasks/policy.js';
import type { TicketRef } from '../tickets/policy.js';
import { isAdmin } from '../users/policy.js';

/**
 * Who reaches projects and events (Phase 33, spec §4, decisions 7, 8 and 8a). Every group rule is
 * `canReadGroup`: admins and the group's clients. A žiadateľ never reads the group, so every
 * project route answers them 404. `actorGroupIds` comes from `clientGroupIds`.
 */

/** See projects, events, their files and the Prehľad tab. */
export function canReadProjects(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, groupId, actorGroupIds);
}

/** Create and edit projects and events, their files and attached knowledge (decision 8). */
export function canEditProjects(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, groupId, actorGroupIds);
}

/** Archive and restore a project (decision 8a). */
export function canArchiveProject(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, groupId, actorGroupIds);
}

/**
 * Merge or delete a project, delete an event, remove an alias, accept an eGrant event removal
 * (decision 8a: clients too).
 */
export function canMergeOrDeleteProject(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, groupId, actorGroupIds);
}

/** Set or clear a task's project and event (part P2): whoever uses the board. */
export function canSetTaskProject(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return canUseBoard(actor, groupId, actorGroupIds);
}

/**
 * Set or clear a ticket's project and event (part P2): an admin or a client of the ticket's
 * group; never a žiadateľ, and never on a ticket without a client (projects are per client).
 * `role` is the actor's active role in the ticket's group (`getMembership`).
 */
export function canSetTicketProject(
  actor: SessionUser,
  ticket: TicketRef,
  role: MemberRole | null,
): boolean {
  return ticket.groupId !== null && (isAdmin(actor) || role === 'client');
}
