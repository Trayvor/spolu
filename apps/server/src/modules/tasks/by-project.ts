import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { tasks } from './schema.js';

/**
 * Open tasks (not in Completed) per project of one client, for the Prehľad projects card
 * (Phase 33 part P1): one grouped count on `tasks_group_project_event_idx`. Projects without
 * open tasks are left out of the map.
 */
export async function openTaskCountsByProject(
  db: Db,
  groupId: string,
  projectIds: string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: tasks.projectId, n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(
      and(
        eq(tasks.groupId, groupId),
        inArray(tasks.projectId, projectIds),
        isNull(tasks.completedAt),
      ),
    )
    .groupBy(tasks.projectId);
  return new Map(rows.map((row) => [row.projectId!, row.n]));
}
