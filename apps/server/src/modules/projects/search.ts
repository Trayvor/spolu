import { sql, type SQL } from 'drizzle-orm';
import type { SearchProjectHit, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { foldSql, matchesAllSql, rankSql, type SearchText } from '../../infra/text/search.js';
import { clientIdsOf, type GroupAccess } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import { canReadProjects } from './policy.js';

type Row = SearchProjectHit & { rank: number };

/**
 * Global search (2026-10-18): the projects and events of the groups `actor` reads
 * (`canReadProjects`: admins every client, a client their groups) by a fragment of the folded
 * name (`projects_name_fold_trgm_idx`, `project_events_name_fold_trgm_idx`). One
 * statement: the two tables' best hits, then the best rank, active projects before archived
 * ones, projects before events, by name. Null when the actor reads no group.
 */
export function projectSearchSql(
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
): SQL | null {
  const readable = isAdmin(actor) ? null : clientIdsOf(access);
  if (readable !== null && readable.length === 0) return null;
  const scope = (column: SQL) =>
    readable === null
      ? sql`true`
      : sql`${column} in (${sql.join(
          readable.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  return sql`select * from (
    (select p.id, 'project' as kind, p.name, p.id as "projectId", p.name as "projectName",
        p.group_id as "groupId", g.name as "groupName",
        ${rankSql(foldSql(sql`p.name`), text.key)} as rank, (p.status = 'archived') as archived
      from projects p inner join groups g on g.id = p.group_id
      where ${matchesAllSql(foldSql(sql`p.name`), text.terms)} and ${scope(sql`p.group_id`)}
        and g.deactivated_at is null
      order by rank, archived, p.name_key, p.id limit ${limit})
    union all
    (select e.id, 'event' as kind, e.name, p.id, p.name, e.group_id, g.name,
        ${rankSql(foldSql(sql`e.name`), text.key)} as rank, (p.status = 'archived') as archived
      from project_events e
      inner join projects p on p.id = e.project_id and p.group_id = e.group_id
      inner join groups g on g.id = e.group_id
      where ${matchesAllSql(foldSql(sql`e.name`), text.terms)} and ${scope(sql`e.group_id`)}
        and g.deactivated_at is null
      order by rank, archived, e.occurs_on desc nulls last, e.id limit ${limit})
  ) hits order by rank, archived, kind desc, name limit ${limit}`;
}

export async function searchProjects(
  db: Db,
  actor: SessionUser,
  access: GroupAccess,
  text: SearchText,
  limit: number,
): Promise<SearchProjectHit[]> {
  const query = projectSearchSql(actor, access, text, limit);
  if (query === null) return [];
  const readable = clientIdsOf(access);
  const rows = [...(await db.execute<Row & { archived: boolean }>(query))];
  // The policy has the last word on every row.
  return rows
    .filter((row) => canReadProjects(actor, row.groupId, readable))
    .map(({ id, kind, name, projectId, projectName, groupId, groupName }) => ({
      id,
      kind,
      name,
      projectId,
      projectName,
      groupId,
      groupName,
    }));
}
