import { sql, type SQL } from 'drizzle-orm';
import { CALENDAR_FEED_LIMITS } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/** An open task's deadline as the personal calendar feed shows it (ADR 0051). */
export type FeedDeadlineRow = {
  id: string;
  groupId: string;
  title: string;
  description: string;
  /** `YYYY-MM-DD`. */
  dueDate: string;
  updatedAt: Date;
};

export type FeedDeadlinesQuery = {
  userId: string;
  groupIds: string[];
  /** Inclusive `YYYY-MM-DD` dates. */
  from: string;
  to: string;
  limit?: number;
};

/**
 * The open tasks (`completed_at is null`) of `groupIds` assigned to `userId` with a due date in
 * `[from, to]`, by date and id, at most `limit`. Starts from `task_assignees_user_id_idx`, then
 * each task by its primary key. `groupIds` must not be empty.
 */
export function feedAssignedDeadlinesSql(q: FeedDeadlinesQuery): SQL {
  return sql`
    select t.id, t.group_id, t.title, t.description, t.due_date::text as due_date,
      to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
    from task_assignees a
    join tasks t on t.id = a.task_id
    where a.user_id = ${q.userId}
      and t.group_id = any(${sql`array[${sql.join(q.groupIds, sql`, `)}]::text[]`})
      and t.completed_at is null
      and t.due_date between ${q.from}::date and ${q.to}::date
    order by t.due_date, t.id
    limit ${q.limit ?? CALENDAR_FEED_LIMITS.rowsPerSource}`;
}

/** See `feedAssignedDeadlinesSql`; one statement, none for no groups. */
export async function feedAssignedDeadlines(
  db: Db,
  q: FeedDeadlinesQuery,
): Promise<FeedDeadlineRow[]> {
  if (q.groupIds.length === 0) return [];
  const rows = await db.execute<{
    id: string;
    group_id: string;
    title: string;
    description: string;
    due_date: string;
    updated_at: string;
  }>(feedAssignedDeadlinesSql(q));
  return [...rows].map((r) => ({
    id: r.id,
    groupId: r.group_id,
    title: r.title,
    description: r.description,
    dueDate: r.due_date,
    updatedAt: new Date(r.updated_at),
  }));
}
