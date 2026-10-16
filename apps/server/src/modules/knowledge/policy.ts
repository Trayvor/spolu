import type { SessionUser, Visibility } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';
import { isAdmin } from '../users/policy.js';

/** Whoever reads the group reads its public items; admins-only items only admins. */
export function canReadItem(
  actor: SessionUser,
  item: { groupId: string; visibility: Visibility | string },
  actorGroupId: string | null,
): boolean {
  return (
    canReadGroup(actor, item.groupId, actorGroupId) &&
    (item.visibility === 'public' || isAdmin(actor))
  );
}

/** The author and admins edit a readable item. */
export function canEditItem(
  actor: SessionUser,
  item: { groupId: string; visibility: Visibility | string; createdBy: string },
  actorGroupId: string | null,
): boolean {
  return canReadItem(actor, item, actorGroupId) && (isAdmin(actor) || item.createdBy === actor.id);
}

export const canDeleteItem = canEditItem;

/**
 * `admins` needs an admin actor and an admin author: a client's own item always stays public.
 * `item` is null on create, where the author is the actor.
 */
export function canSetVisibility(
  actor: SessionUser,
  item: { authorIsClient: boolean } | null,
  visibility: Visibility,
): boolean {
  if (visibility === 'public') return true;
  const authorIsClient = item ? item.authorIsClient : !isAdmin(actor);
  return isAdmin(actor) && !authorIsClient;
}
