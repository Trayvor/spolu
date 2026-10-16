import type { SessionUser, Visibility } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';
import { isAdmin } from '../users/policy.js';

/** Whoever reads the group reads its public items; admins-only items only admins. */
export function canReadItem(
  actor: SessionUser,
  item: { groupId: string; visibility: Visibility | string },
  actorGroupIds: readonly string[],
): boolean {
  return (
    canReadGroup(actor, item.groupId, actorGroupIds) &&
    (item.visibility === 'public' || isAdmin(actor))
  );
}

/**
 * The author and admins edit a readable item. A chat file (`chat_file`) is read-only: it goes
 * with its message in the chat.
 */
export function canEditItem(
  actor: SessionUser,
  item: { groupId: string; visibility: Visibility | string; createdBy: string; type?: string },
  actorGroupIds: readonly string[],
): boolean {
  return (
    item.type !== 'chat_file' &&
    canReadItem(actor, item, actorGroupIds) &&
    (isAdmin(actor) || item.createdBy === actor.id)
  );
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

/**
 * Whoever reads the group sees its public folders; admins-only folders only admins. Seeing a
 * folder is enough to rename, move or delete it (Phase 24 owner decision 3).
 */
export function canReadFolder(
  actor: SessionUser,
  folder: { groupId: string; visibility: Visibility | string },
  actorGroupIds: readonly string[],
): boolean {
  return canReadItem(actor, folder, actorGroupIds);
}

/** Only an admin makes a folder admins-only. */
export function canSetFolderVisibility(actor: SessionUser, visibility: Visibility): boolean {
  return visibility === 'public' || isAdmin(actor);
}
