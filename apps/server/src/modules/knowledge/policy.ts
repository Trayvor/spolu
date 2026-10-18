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
 * Who turns a chat file into a normal file item ("Save as a file"): the people who could edit
 * it, were it hand-made: its author (the message's author) and admins, while they read it.
 */
export function canConvertChatFile(
  actor: SessionUser,
  item: { groupId: string; visibility: Visibility | string; createdBy: string; type?: string },
  actorGroupIds: readonly string[],
): boolean {
  return (
    item.type === 'chat_file' &&
    canReadItem(actor, item, actorGroupIds) &&
    (isAdmin(actor) || item.createdBy === actor.id)
  );
}

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

/**
 * Phase 28: who attaches the group's knowledge items to chat messages, in the group's chats:
 * whoever reads the group (admins and its clients). A ziadatel never does: they read no knowledge.
 */
export function canShareKnowledge(
  actor: SessionUser,
  groupId: string,
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, groupId, actorGroupIds);
}

/**
 * Whether an item may be attached to (and is shown in) a place of `targetGroupId`: its chats
 * and the descriptions of its tasks, tickets, projects, events and knowledge items. The same
 * function answers on save and again on every display. `folderVisibilities`: every folder up
 * the item's tree, any order. `adminGroupId`: the admin group's id (null if unknown).
 *
 * - Phase 28: an item of the target group, public, every folder public (everyone there reads it).
 * - Phase 34 decision 10: an item of the admin group marked "Shareable with clients" (public)
 *   with every folder public; never a file of the team's own chat.
 * - Phase 34 decision 12: into the admin group, any item of any group (its readers are admins).
 */
export function isShareableInto(
  item: { groupId: string; visibility: Visibility | string; type?: string },
  folderVisibilities: readonly string[],
  targetGroupId: string,
  adminGroupId: string | null,
): boolean {
  if (adminGroupId !== null && targetGroupId === adminGroupId) return true;
  const open = item.visibility === 'public' && folderVisibilities.every((v) => v === 'public');
  if (!open) return false;
  if (item.groupId === targetGroupId) return true;
  return adminGroupId !== null && item.groupId === adminGroupId && item.type !== 'chat_file';
}

/**
 * Runs the AI on a meeting ("Spracovať s AI") and turns its action items into tasks (Phase 30):
 * admins only, on a meeting they read (every admin reads every item).
 */
export function canProcessMeeting(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * Teams T1: who lets the client see a transcript imported from Teams ("Share transcript with
 * the client"): admins only, like running the AI on it.
 */
export function canShareMeetingTranscript(actor: SessionUser): boolean {
  return isAdmin(actor);
}
