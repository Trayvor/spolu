import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * The projects module's facts for the weekly client summary (spec 2026-10-19 §4): events of the
 * group's active projects from `fromDay` to `toDay` (both included), by date:
 * `project_events_group_occurs_idx (group_id, occurs_on, id)`, the project by its key.
 */

const FACTS_LIMIT = 50;

export function upcomingEventsOfSql(
  groupId: string,
  fromDay: string,
  toDay: string,
  limit = FACTS_LIMIT,
): SQL {
  return sql`select e.id, e.name, p.name as project_name, e.occurs_on::text as occurs_on
    from project_events e join projects p on p.id = e.project_id
    where e.group_id = ${groupId} and p.status = 'active'
      and e.occurs_on >= ${fromDay}::date and e.occurs_on <= ${toDay}::date
    order by e.occurs_on, e.id limit ${limit}`;
}

export async function upcomingEventsOf(
  db: Db,
  groupId: string,
  fromDay: string,
  toDay: string,
  limit = FACTS_LIMIT,
): Promise<{ id: string; name: string; projectName: string; occursOn: string }[]> {
  const rows = await db.execute<{
    id: string;
    name: string;
    project_name: string;
    occurs_on: string;
  }>(upcomingEventsOfSql(groupId, fromDay, toDay, limit));
  return [...rows].map((r) => ({
    id: r.id,
    name: r.name,
    projectName: r.project_name,
    occursOn: r.occurs_on,
  }));
}

/** `Name (Project)` of those of `ids` that are events of the group now, with the project id. */
export async function eventTitlesInGroup(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<Map<string, { title: string; projectId: string }>> {
  if (ids.length === 0) return new Map();
  const list = sql.join(
    [...new Set(ids)].map((id) => sql`${id}`),
    sql`, `,
  );
  const rows = await db.execute<{
    id: string;
    name: string;
    project_name: string;
    project_id: string;
  }>(
    sql`select e.id, e.name, p.name as project_name, p.id as project_id
      from project_events e join projects p on p.id = e.project_id
      where e.group_id = ${groupId} and e.id in (${list})`,
  );
  return new Map(
    [...rows].map((r) => [
      r.id,
      { title: `${r.name} (${r.project_name})`, projectId: r.project_id },
    ]),
  );
}

/** Which of `ids` are still events of the group (a deleted event is not). */
export async function eventRefsInGroup(
  db: Db,
  groupId: string,
  ids: string[],
): Promise<Set<string>> {
  return new Set((await eventTitlesInGroup(db, groupId, ids)).keys());
}
