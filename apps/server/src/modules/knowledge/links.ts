import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { KNOWLEDGE_LINKS_MAX, type LinkedKnowledge } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { knowledgeItemIdsOfFile, shareableItemCards, type ItemCard } from './chat-items.js';
import { knowledgeLinks } from './schema.js';

/**
 * Knowledge attached to descriptions (Phase 33 part P5, spec §10.3), on the `knowledge_links`
 * table of migration 0038. The owners of the descriptions (tasks, tickets, projects, events,
 * knowledge items) call these inside their writes and DTO builds and never read the table.
 * Only items everyone who reads the description may see are attached: a client group's public,
 * shareable items (`isShareable`, the chat's rule), checked on save and again on display.
 */

export type LinkSubjectKind = 'task' | 'ticket' | 'project' | 'event' | 'knowledge';
export type LinkSubject = { kind: LinkSubjectKind; id: string };
export type { ItemCard };

/** An item that is not shareable in the subject's group, or more than 10 (400 `invalid_knowledge_item`). */
export class InvalidKnowledgeLinkError extends Error {
  constructor() {
    super('A knowledge item cannot be attached to this description');
    this.name = 'InvalidKnowledgeLinkError';
  }
}

const COLUMN = {
  task: knowledgeLinks.taskId,
  ticket: knowledgeLinks.ticketId,
  project: knowledgeLinks.projectId,
  event: knowledgeLinks.eventId,
  knowledge: knowledgeLinks.knowledgeItemId,
} as const;

/** The subject's column set, the others null (the table's CHECK wants exactly one). */
const subjectColumns = ({ kind, id }: LinkSubject) => ({
  taskId: kind === 'task' ? id : null,
  ticketId: kind === 'ticket' ? id : null,
  projectId: kind === 'project' ? id : null,
  eventId: kind === 'event' ? id : null,
  knowledgeItemId: kind === 'knowledge' ? id : null,
});

/**
 * Replaces the subject's linked items with `itemIds`, in that order, in the caller's
 * transaction. At most 10. An item not linked yet must be shareable in `groupId` now
 * (`InvalidKnowledgeLinkError`); one already linked may stay even if it became unavailable
 * (it keeps showing as "Item unavailable" until removed). An item never links itself.
 */
export async function setLinkedItems(
  tx: Db,
  subject: LinkSubject,
  groupId: string,
  itemIds: string[],
): Promise<void> {
  const ids = [...new Set(itemIds)];
  if (ids.length > KNOWLEDGE_LINKS_MAX) throw new InvalidKnowledgeLinkError();
  if (subject.kind === 'knowledge' && ids.includes(subject.id)) {
    throw new InvalidKnowledgeLinkError();
  }
  const column = COLUMN[subject.kind];
  const current = new Set(
    (
      await tx
        .select({ itemId: knowledgeLinks.itemId })
        .from(knowledgeLinks)
        .where(eq(column, subject.id))
    ).map((r) => r.itemId),
  );
  const added = ids.filter((id) => !current.has(id));
  if (added.length > 0) {
    const cards = await shareableItemCards(tx, groupId, added);
    if (added.some((id) => !cards.has(id))) throw new InvalidKnowledgeLinkError();
  }
  if (current.size > 0) await tx.delete(knowledgeLinks).where(eq(column, subject.id));
  if (ids.length === 0) return;
  const columns = subjectColumns(subject);
  await tx
    .insert(knowledgeLinks)
    .values(ids.map((itemId, position) => ({ itemId, position, ...columns })));
}

/**
 * The cards of the items linked to each subject, in order, re-checked as shareable in the
 * subject's group now (one query for the rows, then `shareableItemCards` once per group); an
 * unavailable item (deleted, admins-only, moved away, or a subject without a group) is its id
 * only. Subjects without links are absent from the map.
 */
export async function linkedItemCards(
  db: Db,
  kind: LinkSubjectKind,
  subjects: { id: string; groupId: string | null }[],
): Promise<Map<string, LinkedKnowledge>> {
  const result = new Map<string, LinkedKnowledge>();
  if (subjects.length === 0) return result;
  const column = COLUMN[kind];
  const rows = await db
    .select({ subjectId: column, itemId: knowledgeLinks.itemId })
    .from(knowledgeLinks)
    .where(
      inArray(
        column,
        subjects.map((s) => s.id),
      ),
    )
    .orderBy(asc(column), asc(knowledgeLinks.position));
  if (rows.length === 0) return result;
  const groupOf = new Map(subjects.map((s) => [s.id, s.groupId]));
  const byGroup = new Map<string, string[]>();
  for (const row of rows) {
    const groupId = groupOf.get(row.subjectId!);
    if (!groupId) continue;
    byGroup.set(groupId, [...(byGroup.get(groupId) ?? []), row.itemId]);
  }
  const cardsOf = new Map<string, Map<string, ItemCard>>();
  await Promise.all(
    [...byGroup].map(async ([groupId, ids]) =>
      cardsOf.set(groupId, await shareableItemCards(db, groupId, ids)),
    ),
  );
  for (const row of rows) {
    const subjectId = row.subjectId!;
    const groupId = groupOf.get(subjectId);
    const card = groupId ? cardsOf.get(groupId)?.get(row.itemId) : undefined;
    result.set(subjectId, [
      ...(result.get(subjectId) ?? []),
      card ?? { id: row.itemId, available: false },
    ]);
  }
  return result;
}

/** The linked cards of one subject (`[]` without links). */
export async function linkedCardsOf(
  db: Db,
  kind: LinkSubjectKind,
  id: string,
  groupId: string | null,
): Promise<LinkedKnowledge> {
  return (await linkedItemCards(db, kind, [{ id, groupId }])).get(id) ?? [];
}

/** The ids linked to one subject, in order (a write compares them to tell a change). */
export async function linkedItemIds(db: Db, subject: LinkSubject): Promise<string[]> {
  const rows = await db
    .select({ itemId: knowledgeLinks.itemId })
    .from(knowledgeLinks)
    .where(eq(COLUMN[subject.kind], subject.id))
    .orderBy(asc(knowledgeLinks.position));
  return rows.map((r) => r.itemId);
}

/** Whether the item is linked to this subject (the read-through routes check it). */
export async function isLinked(db: Db, subject: LinkSubject, itemId: string): Promise<boolean> {
  const [row] = await db
    .select({ itemId: knowledgeLinks.itemId })
    .from(knowledgeLinks)
    .where(and(eq(COLUMN[subject.kind], subject.id), eq(knowledgeLinks.itemId, itemId)))
    .limit(1);
  return row !== undefined;
}

/**
 * The tickets whose text links an item this file belongs to, with that item: the tickets
 * module's file read rule (`fileOfTicketLinkedKnowledge`) checks each ticket and item.
 */
export async function ticketLinksOfFile(
  db: Db,
  fileId: string,
): Promise<{ ticketId: string; itemId: string }[]> {
  const itemIds = await knowledgeItemIdsOfFile(db, fileId);
  if (itemIds.length === 0) return [];
  const rows = await db
    .select({ ticketId: knowledgeLinks.ticketId, itemId: knowledgeLinks.itemId })
    .from(knowledgeLinks)
    .where(and(inArray(knowledgeLinks.itemId, itemIds), isNotNull(knowledgeLinks.ticketId)));
  return rows.map((r) => ({ ticketId: r.ticketId!, itemId: r.itemId }));
}
