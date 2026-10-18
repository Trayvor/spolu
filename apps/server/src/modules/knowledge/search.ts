import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { KnowledgeType, SearchKnowledgeHit, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { foldSql, matchesAllSql, rankSql, type SearchText } from '../../infra/text/search.js';
import { clientIdsOf, type GroupAccess } from '../groups/memberships.js';
import { groups } from '../groups/schema.js';
import { isAdmin } from '../users/policy.js';
import { canReadItem } from './policy.js';
import { knowledgeItems } from './schema.js';

/**
 * Global search (2026-10-18): the knowledge items `actor` reads (`canReadItem`: admins every
 * item; a client the public items of their groups; an item in an admins-only folder is itself
 * admins-only) whose `search_text` (title, body, URL, file names; already folded) holds every
 * term (`knowledge_items_search_idx`). Chat files are left out: they live with their message.
 * Best title rank first, then the latest change. One query; null when the actor reads nothing.
 */
export function knowledgeSearchSql(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
) {
  const admin = isAdmin(actor);
  const readable = admin ? null : clientIdsOf(access);
  if (readable !== null && readable.length === 0) return null;
  return db
    .select({
      id: knowledgeItems.id,
      title: knowledgeItems.title,
      type: sql<KnowledgeType>`${knowledgeItems.type}`,
      visibility: knowledgeItems.visibility,
      groupId: knowledgeItems.groupId,
      groupName: groups.name,
    })
    .from(knowledgeItems)
    .innerJoin(groups, eq(groups.id, knowledgeItems.groupId))
    .where(
      and(
        matchesAllSql(knowledgeItems.searchText, text.terms),
        ne(knowledgeItems.type, 'chat_file'),
        // Nothing of a deactivated group, for admins too (owner decision).
        isNull(groups.deactivatedAt),
        readable === null ? undefined : inArray(knowledgeItems.groupId, readable),
        admin ? undefined : eq(knowledgeItems.visibility, 'public'),
      ),
    )
    .orderBy(
      rankSql(foldSql(knowledgeItems.title), text.key),
      desc(knowledgeItems.updatedAt),
      desc(knowledgeItems.id),
    )
    .limit(limit);
}

export async function searchKnowledge(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
): Promise<SearchKnowledgeHit[]> {
  const query = knowledgeSearchSql(db, actor, access, text, limit);
  if (query === null) return [];
  const readable = clientIdsOf(access);
  // The policy has the last word on every row.
  return (await query)
    .filter((row) => canReadItem(actor, row, readable))
    .map(({ id, title, type, groupId, groupName }) => ({ id, title, type, groupId, groupName }));
}
