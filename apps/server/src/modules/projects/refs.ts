import { and, asc, eq, sql } from 'drizzle-orm';
import {
  projectColor,
  type EventRefDto,
  type ProjectColor,
  type ProjectPickerItem,
  type ProjectRefDto,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { InvalidProjectError } from './errors.js';
import { projectEvents, projects } from './schema.js';

/**
 * What other modules use of projects (Phase 33, spec §3.1): validating a pair for a write, the
 * refs their DTOs carry, the pickers, the per-client lock. They never read the projects tables.
 */

export { InvalidProjectError };

/** A project's colour (decision 27): the shared hash of its id. */
export function colorOf(projectId: string): ProjectColor {
  return projectColor(projectId);
}

/**
 * Serialises project writes of one client (create, rename, merge, eGrant deliveries) in the
 * caller's transaction, so concurrent writes cannot create two projects for one key.
 */
export async function lockGroupProjects(tx: Db, groupId: string): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`projects:${groupId}`}, 0))`,
  );
}

/**
 * Validates the `{ projectId, eventId }` pair of a task or ticket write in `groupId`, inside the
 * caller's transaction: null when both are null (no project), the pair when the project is of
 * this client (archived ones too) and the event, if any, of that project. Anything else throws
 * `InvalidProjectError` (400 `invalid_project`). The composite FKs refuse the rest.
 */
export async function getProjectRef(
  db: Db,
  groupId: string,
  projectId: string | null,
  eventId: string | null,
): Promise<{ projectId: string; eventId: string | null } | null> {
  if (projectId === null) {
    if (eventId !== null) throw new InvalidProjectError();
    return null;
  }
  if (eventId === null) {
    const [row] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.groupId, groupId)));
    if (!row) throw new InvalidProjectError();
    return { projectId, eventId: null };
  }
  const [row] = await db
    .select({ id: projectEvents.id })
    .from(projectEvents)
    .where(
      and(
        eq(projectEvents.id, eventId),
        eq(projectEvents.projectId, projectId),
        eq(projectEvents.groupId, groupId),
      ),
    );
  if (!row) throw new InvalidProjectError();
  return { projectId, eventId };
}

/** The refs of a page of tasks or tickets: look a project or an event up by id. */
export type ProjectRefLookup = {
  project(id: string | null): ProjectRefDto | null;
  event(id: string | null): EventRefDto | null;
};

/**
 * Names and colours for a page of DTOs, in one query whatever the page size (never one per row).
 * Unknown ids look up as null.
 */
export async function projectRefs(
  db: Db,
  pairs: readonly { projectId: string | null; eventId: string | null }[],
): Promise<ProjectRefLookup> {
  const projectIds = [...new Set(pairs.flatMap((p) => (p.projectId ? [p.projectId] : [])))];
  const eventIds = [...new Set(pairs.flatMap((p) => (p.eventId ? [p.eventId] : [])))];
  const byProject = new Map<string, ProjectRefDto>();
  const byEvent = new Map<string, EventRefDto>();
  if (projectIds.length > 0 || eventIds.length > 0) {
    const none = sql`array[]::text[]`;
    const ids = (list: string[]) =>
      list.length > 0 ? sql`array[${sql.join(list, sql`, `)}]` : none;
    const rows = await db.execute<{
      kind: 'p' | 'e';
      id: string;
      name: string;
      occurs_on: string | null;
    }>(sql`
      select 'p' as kind, id, name, null as occurs_on from projects where id = any(${ids(projectIds)})
      union all
      select 'e', id, name, occurs_on::text from project_events where id = any(${ids(eventIds)})`);
    for (const row of rows) {
      if (row.kind === 'p') {
        byProject.set(row.id, { id: row.id, name: row.name, color: colorOf(row.id) });
      } else {
        byEvent.set(row.id, { id: row.id, name: row.name, occursOn: row.occurs_on! });
      }
    }
  }
  return {
    project: (id) => (id === null ? null : (byProject.get(id) ?? null)),
    event: (id) => (id === null ? null : (byEvent.get(id) ?? null)),
  };
}

/** Every project of the client for a select: active first, then archived, by name. */
export async function listPickerProjects(db: Db, groupId: string): Promise<ProjectPickerItem[]> {
  const rows = await db
    .select({ id: projects.id, name: projects.name, status: projects.status })
    .from(projects)
    .where(eq(projects.groupId, groupId))
    .orderBy(asc(projects.status), asc(projects.nameKey), asc(projects.id));
  return rows.map((row) => ({ ...row, color: colorOf(row.id) }));
}

/**
 * The client's active projects by name, at most `limit` (the AI task split's context, owner
 * request 2026-10-22). One read of `projects_group_status_name_idx`.
 */
export async function listActiveProjectNames(
  db: Db,
  groupId: string,
  limit: number,
): Promise<{ id: string; name: string }[]> {
  return db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(and(eq(projects.groupId, groupId), eq(projects.status, 'active')))
    .orderBy(asc(projects.nameKey), asc(projects.id))
    .limit(limit);
}
