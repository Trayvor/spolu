import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../../infra/db/client.js';
import { normalizeSearch } from '../../infra/text/search.js';
import { projectNameKeys, projects } from './schema.js';

/**
 * Matching eGrant's project id in a client (Phase 33 part P3, spec §5.5), and what the tickets
 * module shows about a ticket's project's eGrant state. The tickets module calls these; it never
 * reads the projects tables itself.
 */

/**
 * The client's project with this eGrant id (the `egrant_id` key row of `project_name_keys`, so a
 * merged project's id keeps matching its survivor), archived projects included; null when the
 * client has no such project yet.
 */
export async function findEgrantProject(
  tx: Db,
  groupId: string,
  egrantProjectId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ projectId: projectNameKeys.projectId })
    .from(projectNameKeys)
    .where(
      and(
        eq(projectNameKeys.groupId, groupId),
        eq(projectNameKeys.kind, 'egrant_id'),
        eq(projectNameKeys.key, egrantProjectId),
      ),
    );
  return row?.projectId ?? null;
}

/**
 * The fallback switch `TICKETS_PROJECT_FIELD=programme` (decision 1): the client's project whose
 * name or alias has the same name key as `name`; null for none. Never creates a project.
 */
export async function findProjectByName(
  tx: Db,
  groupId: string,
  name: string,
): Promise<string | null> {
  const key = normalizeSearch(name);
  if (key === '') return null;
  const [row] = await tx
    .select({ projectId: projectNameKeys.projectId })
    .from(projectNameKeys)
    .where(
      and(
        eq(projectNameKeys.groupId, groupId),
        eq(projectNameKeys.kind, 'name'),
        eq(projectNameKeys.key, key),
      ),
    );
  return row?.projectId ?? null;
}

/**
 * SQL: the project in `projectId` (a ticket's column) has pending changes from eGrant. One index
 * probe per row (`egrant_changes_project_pending_idx`), for list pages and their filter.
 */
export function pendingEgrantChangesSql(projectId: AnyPgColumn | SQL): SQL<boolean> {
  return sql<boolean>`exists (select 1 from egrant_changes c
    where c.project_id = ${projectId} and c.state = 'pending')`;
}

/** Per project: whether it has pending eGrant changes and whether it is archived. One query. */
export async function projectEgrantFlags(
  db: Db,
  projectIds: readonly string[],
): Promise<Map<string, { egrantChanges: boolean; archived: boolean }>> {
  const ids = [...new Set(projectIds)];
  const result = new Map<string, { egrantChanges: boolean; archived: boolean }>();
  if (ids.length === 0) return result;
  // Qualified by hand: in a one-table select Drizzle writes a bare "id", which the subquery
  // would read as its own column.
  const rows = await db
    .select({
      id: projects.id,
      status: projects.status,
      pending: pendingEgrantChangesSql(sql`"projects"."id"`),
    })
    .from(projects)
    .where(inArray(projects.id, ids));
  for (const row of rows) {
    result.set(row.id, { egrantChanges: row.pending, archived: row.status === 'archived' });
  }
  return result;
}
