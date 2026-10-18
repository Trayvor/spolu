import { eq, inArray } from 'drizzle-orm';
import type { MessageKnowledge } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { adminGroupIdSql } from '../groups/admin-group.js';
import { folderChains } from './folders.js';
import { isShareableInto } from './policy.js';
import { knowledgeAttachments, knowledgeItems } from './schema.js';

/** An item's card in a chat message, while everyone in the chat may read it. */
export type ItemCard = Extract<MessageKnowledge, { available: true }>;

/**
 * The cards of these items that may be shown in a place of `groupId` now (`isShareableInto`:
 * Phase 28's own public items, Phase 34's admin-group items marked "Shareable with clients", or
 * anything in the admin group), by id; the others are left out (unavailable). An admin-group
 * item in a client's place carries `source: 'admin_group'` and no folder path (its folders are
 * internal). Two queries for any number of ids: the items (with the admin group's id), then all
 * their folder chains.
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
      adminGroupId: adminGroupIdSql(),
    })
    .from(knowledgeItems)
    .where(inArray(knowledgeItems.id, unique));
  const adminGroupId = rows[0]?.adminGroupId ?? null;
  const intoAdminGroup = adminGroupId !== null && groupId === adminGroupId;
  // Only the rows that can pass need their folders.
  const candidates = intoAdminGroup
    ? rows
    : rows.filter(
        (r) => r.visibility === 'public' && (r.groupId === groupId || r.groupId === adminGroupId),
      );
  const chainOf = await folderChains(
    db,
    candidates.flatMap((r) => (r.folderId === null ? [] : [r.folderId])),
  );
  for (const row of candidates) {
    const chain = row.folderId === null ? [] : chainOf(row.folderId);
    const folderVisibilities = chain.map((f) => f.visibility);
    if (!isShareableInto(row, folderVisibilities, groupId, adminGroupId)) continue;
    const fromAdminGroup = row.groupId === adminGroupId && row.groupId !== groupId;
    cards.set(row.id, {
      id: row.id,
      available: true,
      type: row.type,
      title: row.title,
      folderPath: fromAdminGroup ? [] : chain.map((f) => f.name),
      ...(fromAdminGroup ? { source: 'admin_group' as const } : {}),
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
