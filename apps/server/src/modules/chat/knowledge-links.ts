import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { MessageKnowledge, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { FileReadRule } from '../files/read-rules.js';
import { clientGroupIds } from '../groups/memberships.js';
import { knowledgeItemIdsOfFile, shareableItemCards } from '../knowledge/chat-items.js';
import { canShareKnowledge } from '../knowledge/policy.js';
import { isAdmin } from '../users/policy.js';
import { actorReadsChannel } from './access.js';
import { channels, messageKnowledgeItems, messages } from './schema.js';

/**
 * Phase 28: knowledge items attached to chat messages. The rows are the chat's; which items may
 * be attached and shown is the knowledge module's call (`shareableItemCards`, `canShareKnowledge`).
 */

/** The actor may not attach knowledge here: they do not read the group (route: 403 forbidden). */
export class KnowledgeShareForbiddenError extends Error {
  constructor() {
    super('Only readers of the group attach its knowledge');
    this.name = 'KnowledgeShareForbiddenError';
  }
}

/** An item is not shareable in this chat (route: 400 invalid_knowledge_item). */
export class InvalidKnowledgeItemError extends Error {
  constructor() {
    super('A knowledge item is not visible to everyone in this chat');
    this.name = 'InvalidKnowledgeItemError';
  }
}

/** Throws unless the actor may attach knowledge in the group and every item is shareable there. */
export async function checkKnowledgeIds(
  db: Db,
  actor: SessionUser,
  groupId: string,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const groupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  if (!canShareKnowledge(actor, groupId, groupIds)) throw new KnowledgeShareForbiddenError();
  const cards = await shareableItemCards(db, groupId, ids);
  if (ids.some((id) => !cards.has(id))) throw new InvalidKnowledgeItemError();
}

/** Writes the rows of a new message, in its order (inside the send's transaction). */
export async function attachKnowledge(tx: Db, messageId: string, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx
    .insert(messageKnowledgeItems)
    .values(ids.map((itemId, position) => ({ messageId, itemId, position })));
}

/**
 * The attached items of these messages, by message id, each checked again: a card while it is
 * shareable in `groupId`, else only its id. Two queries for the rows plus the knowledge
 * module's two, for any number of messages.
 */
export async function loadMessageKnowledge(
  db: Db,
  groupId: string,
  messageIds: string[],
): Promise<Map<string, MessageKnowledge[]>> {
  const byMessage = new Map<string, MessageKnowledge[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db
    .select({ messageId: messageKnowledgeItems.messageId, itemId: messageKnowledgeItems.itemId })
    .from(messageKnowledgeItems)
    .where(inArray(messageKnowledgeItems.messageId, messageIds))
    .orderBy(asc(messageKnowledgeItems.messageId), asc(messageKnowledgeItems.position));
  if (rows.length === 0) return byMessage;
  const cards = await shareableItemCards(
    db,
    groupId,
    rows.map((r) => r.itemId),
  );
  for (const row of rows) {
    const card: MessageKnowledge = cards.get(row.itemId) ?? { id: row.itemId, available: false };
    byMessage.set(row.messageId, [...(byMessage.get(row.messageId) ?? []), card]);
  }
  return byMessage;
}

/** Whether the item is attached to this message. */
export async function isAttached(db: Db, messageId: string, itemId: string): Promise<boolean> {
  const [row] = await db
    .select({ itemId: messageKnowledgeItems.itemId })
    .from(messageKnowledgeItems)
    .where(
      and(eq(messageKnowledgeItems.messageId, messageId), eq(messageKnowledgeItems.itemId, itemId)),
    );
  return row !== undefined;
}

/**
 * A file of a knowledge item attached to a live message of a chat the actor reads, while the
 * item is still shareable there: a ziadatel downloads what the item shows them in a ticket chat,
 * and (Phase 34) a client downloads the files of an admin-group item shared into their group's
 * chats (they do not read the admin group's files otherwise). Registered with the files module
 * by the ticket chat; `readableByRule` never opens an admins-only file.
 */
export const fileOfAttachedKnowledge: FileReadRule = async (db, actor, file) => {
  const itemIds = await knowledgeItemIdsOfFile(db, file.id);
  if (itemIds.length === 0) return false;
  const rows = await db
    .selectDistinct({
      itemId: messageKnowledgeItems.itemId,
      id: channels.id,
      groupId: channels.groupId,
      kind: channels.kind,
      ticketId: channels.ticketId,
    })
    .from(messageKnowledgeItems)
    .innerJoin(messages, eq(messages.id, messageKnowledgeItems.messageId))
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .where(and(inArray(messageKnowledgeItems.itemId, itemIds), isNull(messages.deletedAt)));
  for (const row of rows) {
    if (!(await actorReadsChannel(db, actor, row))) continue;
    if ((await shareableItemCards(db, row.groupId, [row.itemId])).has(row.itemId)) return true;
  }
  return false;
};
