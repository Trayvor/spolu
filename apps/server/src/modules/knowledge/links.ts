/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from '../projects/errors.js';
import type { ItemCard } from './chat-items.js';

/**
 * Knowledge attached to descriptions (Phase 33 part P5, spec §10.3), on the `knowledge_links`
 * table of migration 0036. Stubs written by P1; the owners of the descriptions (tasks, tickets,
 * projects, knowledge) call these inside their writes and DTO builds and never read the table.
 */

export type LinkSubjectKind = 'task' | 'ticket' | 'project' | 'event' | 'knowledge';

/**
 * Replaces the subject's linked items (at most 10, each shareable in `groupId`: `isShareable`,
 * else 400 `invalid_knowledge_item`), in the caller's transaction.
 */
export async function setLinkedItems(
  _tx: Db,
  _subject: { kind: LinkSubjectKind; id: string },
  _groupId: string,
  _itemIds: string[],
): Promise<void> {
  throw new NotImplementedError('setLinkedItems (Phase 33 part P5)');
}

/**
 * The cards of the items linked to each subject, re-checked as shareable now (one query for the
 * rows, then `shareableItemCards`); an unavailable item is left as its id only.
 */
export async function linkedItemCards(
  _db: Db,
  _kind: LinkSubjectKind,
  _subjectIds: string[],
): Promise<Map<string, (ItemCard | { id: string; available: false })[]>> {
  throw new NotImplementedError('linkedItemCards (Phase 33 part P5)');
}
