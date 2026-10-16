import type { Server as SocketIOServer } from 'socket.io';
import {
  KnowledgeEvents,
  KnowledgeSummarySchema,
  type KnowledgeItemDeletedEvent,
  type KnowledgeItemDto,
  type KnowledgeItemEvent,
  type KnowledgeSummary,
  type Visibility,
} from '@spolu/shared';
import { emitToGroup, emitToGroupAdmins, emitToGroupClients } from '../../infra/realtime/rooms.js';

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
