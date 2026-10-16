import { sql, type SQL } from 'drizzle-orm';
import {
  BoardColumnKinds,
  HOME_LIMITS,
  type BoardColumnKind,
  type DueFilter,
  type GlobalBoard,
  type GlobalTaskDto,
  type TaskPerson,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { managedGroupIds } from '../groups/managers.js';

/** The `after` cursor does not parse (route: 400 `invalid_filter`). */
export class InvalidCursorError extends Error {
  constructor() {
    super('The cursor does not parse');
    this.name = 'InvalidCursorError';
  }
}

export type GlobalBoardQuery = {
  /** The chosen clients; null = every group. */
  clientIds: string[] | null;
  viewerId: string;
  /** `me`, `anyone`, `none` (unassigned) or a person id. */
  assignee: string;
  urgent: boolean;
  due?: DueFilter;
  q?: string;
  completed: boolean;
  column?: BoardColumnKind;
  after?: string;
  /** Bratislava's date, `YYYY-MM-DD`: "overdue" and "next 7 days" follow it, not UTC. */
  today: string;
};

/** Today's date in Bratislava, `YYYY-MM-DD`. */
export function bratislavaToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now);
}

/**
 * The board's client scope: the explicit `clients` (`all`: every group, null), else the groups
 * the viewer manages, else every group (null).
 */
export async function resolveClientIds(
  db: Db,
  viewerId: string,
  clients: string[] | 'all' | undefined,
): Promise<string[] | null> {
  if (clients === 'all') return null;
  if (clients) return clients;
  const managed = await managedGroupIds(db, viewerId);
  return managed.length > 0 ? managed : null;
}

/** The sort key, ascending, which is also the keyset: urgent, deadline, client, age, id. */
type Cursor = [notUrgent: boolean, due: string, groupName: string, createdAt: string, id: string];

function encodeCursor(key: Cursor): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

function decodeCursor(value: string): Cursor {
  try {
    const key: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Array.isArray(key) &&
      key.length === 5 &&
      typeof key[0] === 'boolean' &&
      typeof key[1] === 'string' &&
      (key[1] === 'infinity' || /^\d{4}-\d{2}-\d{2}$/.test(key[1])) &&
      typeof key[2] === 'string' &&
      typeof key[3] === 'string' &&
      !Number.isNaN(Date.parse(key[3])) &&
      typeof key[4] === 'string'
    ) {
      return key as Cursor;
    }
  } catch {
    // falls through
  }
  throw new InvalidCursorError();
}

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function assigneeFilter(q: GlobalBoardQuery): SQL {
  const assigned = (userId: string) =>
    sql`exists (select 1 from task_assignees ta where ta.task_id = s.id and ta.user_id = ${userId})`;
  if (q.assignee === 'anyone') return sql`true`;
  if (q.assignee === 'none') {
    return sql`not exists (select 1 from task_assignees ta where ta.task_id = s.id)`;
  }
  return assigned(q.assignee === 'me' ? q.viewerId : q.assignee);
}

function dueFilter(q: GlobalBoardQuery): SQL {
  const today = sql`${q.today}::date`;
  switch (q.due) {
    case 'overdue':
      return sql`s.due_date < ${today}`;
    case 'week':
      return sql`s.due_date between ${today} and ${today} + 6`;
    case 'none':
      return sql`s.due_date is null`;
    default:
      return sql`true`;
  }
}

/**
 * The global task board in ONE statement: the chosen clients' tasks (open, plus with `completed`
 * those completed in the last 30 days, on `tasks_open_group_idx`), filtered, in five columns by
 * bucket kind (every custom bucket in `other`), each sorted by the keyset (not urgent, deadline
 * with none last, client name, created, id) and cut at 50 per column, with each column's total.
 * With `column` and `after` it answers that column's next 50 after the cursor. `people` are the
 * distinct assignees of the client scope, before the assignee filter.
 *
 * Reads the tasks, groups and users tables directly: the read-only exception of `modules/home`.
 */
export function globalBoardSql(q: GlobalBoardQuery): SQL {
  const clients =
    q.clientIds === null
      ? sql`true`
      : q.clientIds.length === 0
        ? sql`false`
        : sql`t.group_id in (${sql.join(
            q.clientIds.map((id) => sql`${id}`),
            sql`, `,
          )})`;
  const completed = q.completed
    ? sql`(t.completed_at is null or t.completed_at > now() - interval '${sql.raw(String(HOME_LIMITS.completedDays))} days')`
    : sql`t.completed_at is null`;
  const urgent = q.urgent ? sql`s.urgent` : sql`true`;
  const search = q.q ? sql`s.title ilike ${`%${escapeLike(q.q)}%`}` : sql`true`;
  const onlyColumn = q.column ? sql`s.col = ${q.column}` : sql`true`;
  const key = sql`(not r.urgent, coalesce(r.due_date, 'infinity'::date), r.group_name, r.created_at, r.id)`;
  let keyset = sql`true`;
  if (q.after) {
    const [notUrgent, due, groupName, createdAt, id] = decodeCursor(q.after);
    keyset = sql`${key} > (${notUrgent}::boolean, ${due}::date, ${groupName}::text, ${createdAt}::timestamptz, ${id}::text)`;
  }
  const page = HOME_LIMITS.columnPage;
  return sql`
    with scope as (
      select t.id, t.group_id, t.bucket_id, t.position, t.title, t.urgent, t.due_date, t.link,
        t.completed_at, t.source_message_id, t.created_at, t.updated_at, t.created_by,
        b.kind as bucket_kind, b.name as bucket_name,
        case b.kind when 'custom' then 'other' else b.kind end as col,
        g.name as group_name, g.logo_key is not null as group_has_logo,
        g.updated_at as group_updated_at
      from tasks t
      join buckets b on b.id = t.bucket_id
      join groups g on g.id = t.group_id
      where ${clients} and ${completed}
    ),
    filtered as (
      select s.*, count(*) over (partition by s.col) as total
      from scope s
      where ${assigneeFilter(q)} and ${urgent} and ${dueFilter(q)} and ${search} and ${onlyColumn}
    ),
    ranked as (
      select r.*,
        row_number() over (partition by r.col order by ${key}) as rn,
        count(*) over (partition by r.col) as remaining
      from filtered r
      where ${keyset}
    ),
    page as (
      select p.*, u.name as creator_name
      from ranked p
      join "user" u on u.id = p.created_by
      where p.rn <= ${page}
    )
    select
      (
        select coalesce(json_agg(json_build_object(
          'col', p.col,
          'remaining', p.remaining,
          'cursor', json_build_array(not p.urgent, coalesce(p.due_date, 'infinity'::date)::text,
            p.group_name, p.created_at::text, p.id),
          'task', json_build_object(
          'id', p.id,
          'groupId', p.group_id,
          'bucketId', p.bucket_id,
          'position', p.position,
          'title', p.title,
          'urgent', p.urgent,
          'dueDate', p.due_date,
          'link', p.link,
          'completedAt', p.completed_at,
          'createdBy', json_build_object('id', p.created_by, 'name', p.creator_name),
          'assignees', coalesce((
            select json_agg(json_build_object('id', au.id, 'name', au.name) order by au.name, au.id)
            from task_assignees ta
            join "user" au on au.id = ta.user_id
            where ta.task_id = p.id
          ), '[]'::json),
          'fileCount', (select count(*)::int from task_attachments tf where tf.task_id = p.id),
          'sourceMessageId', p.source_message_id,
          -- The board card's reminder bell, as on the group board (one correlated count, read
          -- only, on reminder_sets_task_unique and reminder_times_set_at_idx).
          'upcomingReminders', (
            select count(*)::int from reminder_sets rs
            join reminder_times rt on rt.set_id = rs.id
            where rs.task_id = p.id and rt.fired_at is null
          ),
          'createdAt', p.created_at,
          'updatedAt', p.updated_at,
          'groupName', p.group_name,
          'groupHasLogo', p.group_has_logo,
          'groupUpdatedAt', p.group_updated_at,
          'bucketKind', p.bucket_kind,
          'bucketName', p.bucket_name
        )) order by p.col, p.rn), '[]'::json)
        from page p
      ) as tasks,
      (
        select coalesce(json_object_agg(c.col, c.total), '{}'::json)
        from (select col, count(*) as total from filtered group by col) c
      ) as totals,
      (
        select coalesce(json_agg(json_build_object('id', pu.id, 'name', pu.name)
          order by pu.name, pu.id), '[]'::json)
        from (
          select distinct ta.user_id
          from scope s
          join task_assignees ta on ta.task_id = s.id
        ) x
        join "user" pu on pu.id = x.user_id
      ) as people
  `;
}

/** One card as the statement returns it: its column, the rows left from it, its key, the DTO. */
type CardJson = {
  col: BoardColumnKind;
  remaining: number;
  cursor: Cursor;
  task: GlobalTaskDto;
};

type Row = { tasks: CardJson[]; totals: Record<string, number>; people: TaskPerson[] };

const iso = (value: string) => new Date(value).toISOString();

export async function getGlobalBoard(db: Db, q: GlobalBoardQuery): Promise<GlobalBoard> {
  const [row] = [...(await db.execute<Row>(globalBoardSql(q)))];
  const { tasks, totals, people } = row!;
  const kinds = q.column
    ? [q.column]
    : BoardColumnKinds.filter((kind) => kind !== 'done' || q.completed);
  const columns = kinds.map((kind) => {
    const items = tasks.filter((t) => t.col === kind);
    const last = items.at(-1);
    return {
      kind,
      total: totals[kind] ?? 0,
      // JSON timestamps come as `2026-10-01T10:00:00.123+00:00`; the DTOs use `toISOString()`.
      items: items.map(({ task: t }) => ({
        ...t,
        createdAt: iso(t.createdAt),
        updatedAt: iso(t.updatedAt),
        completedAt: t.completedAt === null ? null : iso(t.completedAt),
        groupUpdatedAt: iso(t.groupUpdatedAt),
      })),
      next: last && last.remaining > HOME_LIMITS.columnPage ? encodeCursor(last.cursor) : null,
    };
  });
  return { columns, people };
}
