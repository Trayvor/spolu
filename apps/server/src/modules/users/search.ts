import { and, asc, isNull, sql } from 'drizzle-orm';
import type { SearchPersonHit, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { foldSql, matchesAllSql, rankSql, type SearchText } from '../../infra/text/search.js';
import { firstActiveGroupSql } from '../groups/memberships.js';
import { canSearchPeople } from './policy.js';
import { user } from './schema.js';

/**
 * Global search (2026-10-18): active people (admins and clients, not disabled) by a fragment of
 * their folded name or email (`user_search_fold_trgm_idx`), each with the first group of their
 * memberships. Admins only (`canSearchPeople`): a client never lists people outside a group.
 * Best name rank first, then by name. One query.
 */
export function peopleSearchSql(db: Db, text: SearchText, limit: number) {
  const folded = foldSql(sql`${user.name} || ' ' || ${user.email}`);
  return db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      // Qualified by hand: a one-table select renders its columns without the table name, which
      // the subquery's own `groups.id` would capture.
      group: firstActiveGroupSql(sql`"user"."id"`),
    })
    .from(user)
    .where(and(matchesAllSql(folded, text.terms), isNull(user.disabledAt)))
    .orderBy(rankSql(folded, text.key), asc(user.name), asc(user.id))
    .limit(limit);
}

export async function searchPeople(
  db: Db,
  actor: SessionUser,
  text: SearchText,
  limit: number,
): Promise<SearchPersonHit[]> {
  if (!canSearchPeople(actor)) return [];
  const rows = await peopleSearchSql(db, text, limit);
  return rows.map(({ group, ...row }) => ({
    ...row,
    groupId: group?.id ?? null,
    groupName: group?.name ?? null,
  }));
}
