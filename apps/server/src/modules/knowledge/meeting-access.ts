import { eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { clientGroupIds } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import { KnowledgeForbiddenError, KnowledgeNotFoundError } from './errors.js';
import { canEditItem, canProcessMeeting, canReadItem } from './policy.js';
import { knowledgeItems } from './schema.js';

export type MeetingItem = {
  id: string;
  groupId: string;
  visibility: 'public' | 'admins';
  title: string;
  createdBy: string;
};

/** A meeting item, or null (another type, or no such item). No access check. */
export async function findMeetingItem(db: Db, id: string): Promise<MeetingItem | null> {
  const [row] = await db
    .select({
      id: knowledgeItems.id,
      groupId: knowledgeItems.groupId,
      visibility: knowledgeItems.visibility,
      title: knowledgeItems.title,
      createdBy: knowledgeItems.createdBy,
      type: knowledgeItems.type,
    })
    .from(knowledgeItems)
    .where(eq(knowledgeItems.id, id));
  if (!row || row.type !== 'meeting') return null;
  return { ...row, visibility: row.visibility as MeetingItem['visibility'] };
}

/**
 * The meeting `id` when the actor may `read` it, `edit` it (its author and admins) or run the
 * AI on it (`admin`: admins only). Unknown, another type or unreadable: KnowledgeNotFoundError;
 * readable but not allowed: KnowledgeForbiddenError.
 */
export async function meetingFor(
  db: Db,
  actor: SessionUser,
  id: string,
  need: 'read' | 'edit' | 'admin',
): Promise<MeetingItem> {
  const item = await findMeetingItem(db, id);
  if (!item) throw new KnowledgeNotFoundError();
  const groupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  const policyItem = { ...item, type: 'meeting' };
  if (!canReadItem(actor, policyItem, groupIds)) throw new KnowledgeNotFoundError();
  if (need === 'edit' && !canEditItem(actor, policyItem, groupIds)) {
    throw new KnowledgeForbiddenError();
  }
  if (need === 'admin' && !canProcessMeeting(actor)) throw new KnowledgeForbiddenError();
  return item;
}
