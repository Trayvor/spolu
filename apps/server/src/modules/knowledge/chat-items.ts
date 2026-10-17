import { eq, inArray } from 'drizzle-orm';
import type { MessageKnowledge } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { folderChains } from './folders.js';
import { isShareable } from './policy.js';
import { knowledgeAttachments, knowledgeItems } from './schema.js';

/** An item's card in a chat message, while everyone in the chat may read it. */
export type ItemCard = Extract<MessageKnowledge, { available: true }>;

/**
 * Phase 28: the cards of these items that are shareable in `groupId`'s chats now (`isShareable`:
 * the group's, public, every folder public), by id; the others are left out (unavailable). Two
 * queries for any number of ids: the items, then all their folder chains.
 */
export async function shareableItemCards(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<Map<string, ItemCard>> {
  const cards = new Map<string, ItemCard>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return cards;
  const rows = await db
    .select({
      id: knowledgeItems.id,
      groupId: knowledgeItems.groupId,
      type: knowledgeItems.type,
      visibility: knowledgeItems.visibility,
      title: knowledgeItems.title,
      folderId: knowledgeItems.folderId,
    })
    .from(knowledgeItems)
    .where(inArray(knowledgeItems.id, unique));
  // Only the rows that can pass need their folders.
  const candidates = rows.filter((r) => r.groupId === groupId && r.visibility === 'public');
  const chainOf = await folderChains(
    db,
    candidates.flatMap((r) => (r.folderId === null ? [] : [r.folderId])),
  );
  for (const row of candidates) {
    const chain = row.folderId === null ? [] : chainOf(row.folderId);
    const folderVisibilities = chain.map((f) => f.visibility);
    if (!isShareable(row, folderVisibilities, groupId)) continue;
    cards.set(row.id, {
      id: row.id,
      available: true,
      type: row.type,
      title: row.title,
      folderPath: chain.map((f) => f.name),
    });
  }
  return cards;
}

/** The items a file belongs to: a note's or file item's attachment, or a chat file's own file. */
export async function knowledgeItemIdsOfFile(db: Db, fileId: string): Promise<string[]> {
  const [attached, chat] = await Promise.all([
    db
      .select({ id: knowledgeAttachments.itemId })
      .from(knowledgeAttachments)
      .where(eq(knowledgeAttachments.fileId, fileId)),
    db
      .select({ id: knowledgeItems.id })
      .from(knowledgeItems)
      .where(eq(knowledgeItems.chatFileId, fileId)),
  ]);
  return [...new Set([...attached, ...chat].map((r) => r.id))];
}
