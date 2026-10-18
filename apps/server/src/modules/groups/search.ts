import { and, asc, inArray, isNull, sql } from 'drizzle-orm';
import type { SearchGroupHit, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { foldSql, matchesAllSql, rankSql, type SearchText } from '../../infra/text/search.js';
import { isAdmin } from '../users/policy.js';
import { clientIdsOf, type GroupAccess } from './memberships.js';
import { canReadGroup } from './policy.js';
import { groups } from './schema.js';

/**
 * Global search (2026-10-18): the groups `actor` reads (`canReadGroup`: admins every group, the
 * admin group too; a client their client groups) whose folded name holds every term
 * (`groups_name_fold_trgm_idx`). A deactivated group is left out for admins too, as in the
 * sidebar (`GET /api/groups`). Best rank first, then by name. One query.
 */
export function groupSearchSql(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
) {
  const folded = foldSql(groups.name);
  const readable = isAdmin(actor) ? null : clientIdsOf(access);
  return db
    .select({ id: groups.id, name: groups.name, kind: groups.kind })
    .from(groups)
    .where(
      and(
        matchesAllSql(folded, text.terms),
        isNull(groups.deactivatedAt),
        readable === null
          ? undefined
          : readable.length === 0
            ? sql`false`
            : inArray(groups.id, readable),
      ),
    )
    .orderBy(rankSql(folded, text.key), asc(groups.name), asc(groups.id))
    .limit(limit);
}

export async function searchGroups(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
): Promise<SearchGroupHit[]> {
  const readable = clientIdsOf(access);
  if (!isAdmin(actor) && readable.length === 0) return [];
  const rows = await groupSearchSql(db, actor, access, text, limit);
  // The policy has the last word on every row.
  return rows.filter((row) => canReadGroup(actor, row.id, readable));
}
