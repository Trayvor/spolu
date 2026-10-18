import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { ProjectFilter } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { tasks } from './schema.js';

/**
 * Tasks and projects (Phase 33 part P2): the board filters and the merge's move. The pair itself
 * is validated by the projects module's `getProjectRef` in the write's transaction.
 */

/**
 * The `project` / `event` filter of a board read (`<id>` or `none`), on
 * `tasks_group_project_event_idx`; undefined when neither is set. The route checked that an
 * event comes with a project (`isValidProjectFilter`).
 */
export function taskProjectFilter(filter: ProjectFilter): SQL | undefined {
  const parts: SQL[] = [];
  if (filter.project === 'none') parts.push(isNull(tasks.projectId));
  else if (filter.project !== undefined) parts.push(eq(tasks.projectId, filter.project));
  if (filter.event === 'none') parts.push(isNull(tasks.eventId));
  else if (filter.event !== undefined) parts.push(eq(tasks.eventId, filter.event));
  return parts.length > 0 ? and(...parts) : undefined;
}

/**
 * Moves the client's tasks of project `fromProjectId` (those without an event; tasks on an
 * event follow the event through its FK's `on update cascade`) to `toProjectId`, in the merge's
 * transaction (Phase 33, spec §3.1). One statement on `tasks_group_project_event_idx`.
 */
export async function reassignTaskProject(
  tx: Db,
  groupId: string,
  fromProjectId: string,
  toProjectId: string,
): Promise<void> {
  await tx
    .update(tasks)
    .set({ projectId: toProjectId })
    .where(
      and(eq(tasks.groupId, groupId), eq(tasks.projectId, fromProjectId), isNull(tasks.eventId)),
    );
}

type Pair = { projectId: string | null; eventId: string | null };

/**
 * The pair a task write asks for (Phase 33 part P2). In a body, an absent field leaves the
 * current value; a new project without an event drops the old event; `projectId: null` clears
 * both. The result still goes through `getProjectRef`.
 */
export function requestedProjectPair(
  current: Pair,
  body: { projectId?: string | null; eventId?: string | null },
): Pair {
  const projectId = body.projectId !== undefined ? body.projectId : current.projectId;
  const eventId =
    body.eventId !== undefined
      ? body.eventId
      : projectId === current.projectId
        ? current.eventId
        : null;
  return { projectId, eventId };
}

/**
 * The project and event of each of these tasks (Phase 33 part P6): what the finance module's
 * startup backfill copies onto time entries made before its migration, so finance never reads
 * `tasks`. One query on the primary key; unknown ids are absent.
 */
export async function projectOfTasks(
  db: Db,
  ids: readonly string[],
): Promise<Map<string, { projectId: string | null; eventId: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: tasks.id, projectId: tasks.projectId, eventId: tasks.eventId })
    .from(tasks)
    .where(inArray(tasks.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { projectId: r.projectId, eventId: r.eventId }]));
}
