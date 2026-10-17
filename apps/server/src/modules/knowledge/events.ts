import type { Server as SocketIOServer } from 'socket.io';
import {
  KnowledgeEvents,
  KnowledgeSummarySchema,
  type KnowledgeFolderDeletedEvent,
  type KnowledgeFolderDto,
  type KnowledgeFolderEvent,
  type KnowledgeItemDeletedEvent,
  type KnowledgeItemDto,
  type KnowledgeItemEvent,
  type KnowledgeMeetingTasksEvent,
  type KnowledgeSummary,
  type Visibility,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { emitToGroup, emitToGroupAdmins, emitToGroupClients } from '../../infra/realtime/rooms.js';
import { findMeetingItem } from './meeting-access.js';

const SUMMARY_KEYS = Object.keys(KnowledgeSummarySchema.shape) as (keyof KnowledgeSummary)[];

/**
 * The list row of an item: only the summary's own fields (an allowlist), so a detail's body,
 * files, reminder and the actor's own flags (`canEdit`) never reach other readers.
 */
export function toEventSummary(item: KnowledgeSummary | KnowledgeItemDto): KnowledgeSummary {
  const summary: Record<string, unknown> = {};
  for (const key of SUMMARY_KEYS) if (key in item) summary[key] = item[key];
  return summary as KnowledgeSummary;
}

/**
 * Pushes a created or edited item after the commit. A public item goes to the group room, an
 * admins-only one to the group's admins room only. Public → admins deletes it for the clients
 * (the group room except its admins, so an admin's open view of it stays) and sends it to the
 * admins room.
 */
export function emitKnowledgeItem(
  io: SocketIOServer,
  item: KnowledgeSummary | KnowledgeItemDto,
  previousVisibility?: Visibility,
): void {
  const event: KnowledgeItemEvent = { item: toEventSummary(item) };
  const { groupId } = item;
  if (item.visibility === 'public') {
    emitToGroup(io, groupId, KnowledgeEvents.item, event);
    return;
  }
  if (previousVisibility === 'public') {
    const deleted: KnowledgeItemDeletedEvent = { groupId, id: item.id };
    emitToGroupClients(io, groupId, KnowledgeEvents.itemDeleted, deleted);
  }
  emitToGroupAdmins(io, groupId, KnowledgeEvents.item, event);
}

/** Pushes a deletion to the readers of the item: the group room, or the admins room. */
export function emitKnowledgeDeleted(
  io: SocketIOServer,
  item: { groupId: string; id: string; visibility: Visibility },
): void {
  const event: KnowledgeItemDeletedEvent = { groupId: item.groupId, id: item.id };
  if (item.visibility === 'public')
    emitToGroup(io, item.groupId, KnowledgeEvents.itemDeleted, event);
  else emitToGroupAdmins(io, item.groupId, KnowledgeEvents.itemDeleted, event);
}

/**
 * Pushes a created or changed folder after the commit, routed like an item. Public → admins-only
 * deletes the folder for the clients, and each item that stopped being public (`hiddenItemIds`).
 */
export function emitKnowledgeFolder(
  io: SocketIOServer,
  folder: KnowledgeFolderDto,
  previousVisibility?: Visibility,
  hiddenItemIds: string[] = [],
): void {
  const event: KnowledgeFolderEvent = { folder };
  const { groupId } = folder;
  if (folder.visibility === 'public') {
    emitToGroup(io, groupId, KnowledgeEvents.folder, event);
    return;
  }
  if (previousVisibility === 'public') {
    const deleted: KnowledgeFolderDeletedEvent = { groupId, id: folder.id };
    emitToGroupClients(io, groupId, KnowledgeEvents.folderDeleted, deleted);
  }
  for (const id of hiddenItemIds) {
    const gone: KnowledgeItemDeletedEvent = { groupId, id };
    emitToGroupClients(io, groupId, KnowledgeEvents.itemDeleted, gone);
  }
  emitToGroupAdmins(io, groupId, KnowledgeEvents.folder, event);
}

/** Pushes a folder's deletion to its readers: the group room, or the admins room. */
export function emitKnowledgeFolderDeleted(
  io: SocketIOServer,
  folder: { groupId: string; id: string; visibility: Visibility },
): void {
  const event: KnowledgeFolderDeletedEvent = { groupId: folder.groupId, id: folder.id };
  if (folder.visibility === 'public') {
    emitToGroup(io, folder.groupId, KnowledgeEvents.folderDeleted, event);
  } else emitToGroupAdmins(io, folder.groupId, KnowledgeEvents.folderDeleted, event);
}

/**
 * Tells a meeting's readers (the group room, or its admins room for an admins-only one) to refetch
 * its detail after a task made from it was created, edited, moved or deleted (the detail lists
 * those tasks). Call it after the write committed; a deleted meeting is skipped.
 */
export async function emitMeetingTasks(
  io: SocketIOServer,
  db: Db,
  meetingId: string | null,
): Promise<void> {
  if (meetingId === null) return;
  const item = await findMeetingItem(db, meetingId);
  if (!item) return;
  const event: KnowledgeMeetingTasksEvent = { groupId: item.groupId, id: item.id };
  if (item.visibility === 'public')
    emitToGroup(io, item.groupId, KnowledgeEvents.meetingTasks, event);
  else emitToGroupAdmins(io, item.groupId, KnowledgeEvents.meetingTasks, event);
}
