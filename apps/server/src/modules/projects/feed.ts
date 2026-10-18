import { sql, type SQL } from 'drizzle-orm';
import { CALENDAR_FEED_LIMITS } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/** A project event as the personal calendar feed shows it (ADR 0051). */
export type FeedEventRow = {
  id: string;
  groupId: string;
  projectName: string;
  name: string;
  description: string;
  /** `YYYY-MM-DD`. */
  occursOn: string;
  updatedAt: Date;
};

export type FeedEventsQuery = {
  groupIds: string[];
  /** Inclusive `YYYY-MM-DD` dates. */
  from: string;
  to: string;
  limit?: number;
};

const textArray = (ids: string[]) => sql`array[${sql.join(ids, sql`, `)}]::text[]`;

/**
 * The events of active projects of `groupIds` dated in `[from, to]`, by date and id, at most
 * `limit`. Reads `project_events_group_occurs_idx (group_id, occurs_on, id)` and joins the
 * project by its key. `groupIds` must not be empty.
 */
export function feedEventsSql(q: FeedEventsQuery): SQL {
  return sql`
    select e.id, e.group_id, p.name as project_name, e.name, e.description,
      e.occurs_on::text as occurs_on,
      to_char(e.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
    from project_events e
    join projects p on p.id = e.project_id and p.group_id = e.group_id
    where e.group_id = any(${textArray(q.groupIds)})
      and e.occurs_on between ${q.from}::date and ${q.to}::date
      and p.status = 'active'
    order by e.occurs_on, e.id
    limit ${q.limit ?? CALENDAR_FEED_LIMITS.rowsPerSource}`;
}

/** See `feedEventsSql`; one statement, none for no groups. */
export async function feedEvents(db: Db, q: FeedEventsQuery): Promise<FeedEventRow[]> {
  if (q.groupIds.length === 0) return [];
  const rows = await db.execute<{
    id: string;
    group_id: string;
    project_name: string;
    name: string;
    description: string;
    occurs_on: string;
    updated_at: string;
  }>(feedEventsSql(q));
  return [...rows].map((r) => ({
    id: r.id,
    groupId: r.group_id,
    projectName: r.project_name,
    name: r.name,
    description: r.description,
    occursOn: r.occurs_on,
    updatedAt: new Date(r.updated_at),
  }));
}
