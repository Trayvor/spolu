import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * The tasks under the timeline's events (Phase 33 part P4, spec §3.1, §7.3), for the projects
 * module, which never reads `tasks` itself. Every read goes through `tasks_event_project_idx`
 * (`event_id`) and the client's `group_id`. Open tasks are ordered as on the overview's card:
 * urgent first, then by deadline (none last), then oldest first; done tasks newest first.
 */

/** A task under an event; `assigneeIds` are named by the caller in one batch. */
export type EventTaskRow = {
  id: string;
  eventId: string;
  title: string;
  dueDate: string | null;
  urgent: boolean;
  /** ISO, microseconds: the done pile's keyset. */
  completedAt: string | null;
  /** ISO, microseconds: the open list's keyset. */
  createdAt: string;
  assigneeIds: string[];
};

/** Where an open list continues: the last row's sort key. */
export type OpenTaskCursor = {
  urgent: boolean;
  dueDate: string | null;
  createdAt: string;
  id: string;
};
/**
 * Where the done pile continues, newest first: before the row (`at`, `id`); without `id`, before
 * the instant `at`, or at it too when `inclusive` (the pile merges tasks and tickets).
 */
export type DoneCursor = { at: string; id?: string; inclusive?: boolean };

/** The done pile's keyset condition on `column` (a timestamp) and `idColumn`. */
export function doneBefore(column: SQL, idColumn: SQL, cursor: DoneCursor | undefined): SQL {
  if (!cursor) return sql``;
  if (cursor.id !== undefined) {
    return sql`and (${column}, ${idColumn}) < (${cursor.at}::timestamptz, ${cursor.id})`;
  }
  return cursor.inclusive
    ? sql`and ${column} <= ${cursor.at}::timestamptz`
    : sql`and ${column} < ${cursor.at}::timestamptz`;
}

type Row = {
  id: string;
  event_id: string;
  title: string;
  due_date: string | null;
  urgent: boolean;
  completed_at: string | null;
  created_at: string;
  assignee_ids: string[];
};

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
const iso = (column: SQL) => sql`to_char(${column} at time zone 'UTC', ${ISO})`;

const toRow = (r: Row): EventTaskRow => ({
  id: r.id,
  eventId: r.event_id,
  title: r.title,
  dueDate: r.due_date,
  urgent: r.urgent,
  completedAt: r.completed_at,
  createdAt: r.created_at,
  assigneeIds: r.assignee_ids,
});

const columns = sql`t.id, t.event_id, t.title, t.due_date::text as due_date, t.urgent,
  ${iso(sql`t.completed_at`)} as completed_at, ${iso(sql`t.created_at`)} as created_at`;
const assigneeIds = (alias: SQL) =>
  sql`array(select a.user_id from task_assignees a where a.task_id = ${alias}.id order by a.user_id)`;
const OPEN_ORDER = sql`t.urgent desc, t.due_date asc nulls last, t.created_at, t.id`;

/** The statement of the events' rows and counts, exported for the EXPLAIN check. */
export function tasksByEventsSql(groupId: string, eventIds: string[], openLimit: number): SQL {
  return sql`
    select x.*, case when not x.done then ${assigneeIds(sql`x`)} else '{}'::text[] end as assignee_ids
    from (
      select ${columns}, t.completed_at is not null as done,
        (row_number() over (partition by t.event_id, t.completed_at is null
          order by ${OPEN_ORDER}))::int as rn,
        (count(*) over (partition by t.event_id, t.completed_at is null))::int as n
      from tasks t
      where t.event_id = any(${sql`array[${sql.join(eventIds, sql`, `)}]::text[]`})
        and t.group_id = ${groupId}
    ) x
    where (not x.done and x.rn <= ${openLimit}) or (x.done and x.rn = 1)
    order by x.event_id, x.done, x.rn`;
}

/**
 * Up to `openLimit` open tasks of each event and each event's open and done counts, in one
 * query: a window over the events' tasks, split into open and done. Events without tasks are
 * left out of the map.
 */
export async function tasksByEvents(
  db: Db,
  groupId: string,
  eventIds: string[],
  opts: { openLimit: number },
): Promise<Map<string, { open: EventTaskRow[]; openCount: number; doneCount: number }>> {
  const result = new Map<string, { open: EventTaskRow[]; openCount: number; doneCount: number }>();
  if (eventIds.length === 0) return result;
  const rows = await db.execute<Row & { done: boolean; n: number; rn: number }>(
    tasksByEventsSql(groupId, eventIds, opts.openLimit),
  );
  for (const row of rows) {
    let entry = result.get(row.event_id);
    if (!entry) {
      entry = { open: [], openCount: 0, doneCount: 0 };
      result.set(row.event_id, entry);
    }
    if (row.done) entry.doneCount = row.n;
    else {
      entry.openCount = row.n;
      entry.open.push(toRow(row));
    }
  }
  return result;
}

/** One page of an event's open tasks (the event sheet), `limit` rows after `after`. */
export async function openTasksOfEvent(
  db: Db,
  groupId: string,
  eventId: string,
  opts: { after?: OpenTaskCursor; limit: number },
): Promise<EventTaskRow[]> {
  const after = opts.after
    ? sql`and (not t.urgent, coalesce(t.due_date, 'infinity'::date), t.created_at, t.id) >
        (${!opts.after.urgent}, coalesce(${opts.after.dueDate}::date, 'infinity'::date),
         ${opts.after.createdAt}::timestamptz, ${opts.after.id})`
    : sql``;
  const rows = await db.execute<Row>(sql`
    select ${columns}, ${assigneeIds(sql`t`)} as assignee_ids
    from tasks t
    where t.event_id = ${eventId} and t.group_id = ${groupId} and t.completed_at is null ${after}
    order by ${OPEN_ORDER}
    limit ${opts.limit}`);
  return [...rows].map(toRow);
}

/** One page of an event's completed tasks (the done pile), newest first, before `before`. */
export async function doneTasksOfEvent(
  db: Db,
  groupId: string,
  eventId: string,
  opts: { before?: DoneCursor; limit: number },
): Promise<EventTaskRow[]> {
  const before = doneBefore(sql`t.completed_at`, sql`t.id`, opts.before);
  const rows = await db.execute<Row>(sql`
    select ${columns}, '{}'::text[] as assignee_ids
    from tasks t
    where t.event_id = ${eventId} and t.group_id = ${groupId} and t.completed_at is not null
      ${before}
    order by t.completed_at desc, t.id desc
    limit ${opts.limit}`);
  return [...rows].map(toRow);
}
