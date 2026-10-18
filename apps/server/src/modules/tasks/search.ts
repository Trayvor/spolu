import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { SearchTaskHit, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { foldSql, matchesAllSql, rankSql, type SearchText } from '../../infra/text/search.js';
import { clientIdsOf, type GroupAccess } from '../groups/memberships.js';
import { groups } from '../groups/schema.js';
import { isAdmin } from '../users/policy.js';
import { canUseBoard } from './policy.js';
import { tasks } from './schema.js';

/**
 * Global search (2026-10-18): the tasks of the boards `actor` reads (`canUseBoard`: admins every
 * board, the admin group's too; a client their groups' boards) by a fragment of the folded title
 * (`tasks_title_fold_trgm_idx`). Best rank first, open before done, newest first. One query; null
 * when the actor reads no board.
 */
export function taskSearchSql(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
) {
  const readable = isAdmin(actor) ? null : clientIdsOf(access);
  if (readable !== null && readable.length === 0) return null;
  const folded = foldSql(tasks.title);
  return db
    .select({
      id: tasks.id,
      title: tasks.title,
      done: sql<boolean>`${tasks.completedAt} is not null`,
      groupId: tasks.groupId,
      groupName: groups.name,
    })
    .from(tasks)
    .innerJoin(groups, eq(groups.id, tasks.groupId))
    .where(
      and(
        matchesAllSql(folded, text.terms),
        // A deactivated group's tasks are left out, as in the global board and the task search
        // across groups (`allTaskSearchQuery`); the join already has the group.
        isNull(groups.deactivatedAt),
        readable === null ? undefined : inArray(tasks.groupId, readable),
      ),
    )
    .orderBy(
      rankSql(folded, text.key),
      sql`(${tasks.completedAt} is not null)`,
      desc(tasks.createdAt),
      desc(tasks.id),
    )
    .limit(limit);
}

export async function searchTasksOf(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
): Promise<SearchTaskHit[]> {
  const query = taskSearchSql(db, actor, access, text, limit);
  if (query === null) return [];
  const readable = clientIdsOf(access);
  // The policy has the last word on every row.
  return (await query).filter((row) => canUseBoard(actor, row.groupId, readable));
}
