import type { SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/**
 * Weekly summaries (spec 2026-10-19 §11). Every admin reads every draft, revision and the
 * archive; only the group's manager (`managesGroup`, from the groups module's `isGroupManager`)
 * edits, regenerates, sends, skips or switches a group; a client only sets their own email
 * opt-out for a group they belong to.
 */
export function canReadWeeklySummaries(actor: SessionUser): boolean {
  return isAdmin(actor);
}

export function canManageWeeklySummary(actor: SessionUser, managesGroup: boolean): boolean {
  return isAdmin(actor) && managesGroup;
}

/** `actorGroupIds`: the client's active client groups (`clientGroupIds`). */
export function canSetMyWeeklySummary(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return actor.role === 'client' && actorGroupIds.includes(groupId);
}
