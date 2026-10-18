import { linkedCountSql } from '../knowledge/links.js';
import { sql, type SQL } from 'drizzle-orm';
import {
  CUSTOM_COLUMN_PREFIX,
  HOME_LIMITS,
  type DueFilter,
  type GlobalBoard,
  type GlobalColumn,
  type GlobalColumnId,
  type GlobalTaskDto,
  type TaskPerson,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { withAdminGroup } from '../groups/admin-group.js';
import { managedGroupIds } from '../groups/managers.js';
import { projectRefs } from '../projects/refs.js';
import { taskUnseenSql } from '../notifications/unseen.js';

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
  /** Only the tasks the viewer created or is an assignee of. */
  mine: boolean;
  due?: DueFilter;
  q?: string;
  completed: boolean;
  /** A column id (`todo`, `other`, `custom:<key>`…): only that column, for "Show 50 more". */
  column?: GlobalColumnId;
  after?: string;
  /** Bratislava's date, `YYYY-MM-DD`: "overdue" and "next 7 days" follow it, not UTC. */
  today: string;
  /** Phase 33 part P2: `<id>` or `none`; the route allows it only with exactly one client. */
  project?: string;
};

/** Today's date in Bratislava, `YYYY-MM-DD`. */
export function bratislavaToday(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now);
}

/**
 * The board's client scope: the explicit `clients` (`all`: every group, null), else the groups
 * the viewer manages plus the admin group (Phase 34, decision 7), else every group (null).
 */
export async function resolveClientIds(
  db: Db,
  viewerId: string,
  clients: string[] | 'all' | undefined,
): Promise<string[] | null> {
  if (clients === 'all') return null;
  if (clients) return clients;
  const managed = await withAdminGroup(db, await managedGroupIds(db, viewerId));
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

function mineFilter(q: GlobalBoardQuery): SQL {
  if (!q.mine) return sql`true`;
  return sql`(s.created_by = ${q.viewerId} or exists (
    select 1 from task_assignees ta where ta.task_id = s.id and ta.user_id = ${q.viewerId}))`;
}

function projectFilter(q: GlobalBoardQuery): SQL {
  if (q.project === undefined) return sql`true`;
  if (q.project === 'none') return sql`s.project_id is null`;
  return sql`s.project_id = ${q.project}`;
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
 * A custom bucket's name as shown: trimmed, inner whitespace collapsed.
 */
const spelling = (name: SQL) => sql`btrim(regexp_replace(${name}, '\\s+', ' ', 'g'))`;

// Slovak, Czech, German and Hungarian letters with diacritics and their plain letters.
const ACCENTED = 'áäčďéěíĺľňóôöőŕřšťúůüűýžÁÄČĎÉĚÍĹĽŇÓÔÖŐŔŘŠŤÚŮÜŰÝŽ';
const PLAIN = 'aacdeeillnoooorrstuuuuyzAACDEEILLNOOOORRSTUUUUYZ';

/**
 * The key that merges custom buckets across clients: the spelling without diacritics (a fixed
 * `translate`, no extension), lower-cased. `translate` first, so `lower` only meets ASCII letters
 * here and behaves the same under any database locale.
 */
const nameKey = (name: SQL) => sql`lower(translate(${name}, ${ACCENTED}, ${PLAIN}))`;

/**
 * The global task board in ONE statement: the chosen clients' tasks (open, plus with `completed`
 * those completed in the last 30 days, on `tasks_open_group_idx`), filtered (`mine`: the viewer
 * created it or is an assignee), in columns: the fixed bucket kinds, plus one column per custom
 * bucket name of the client scope (merged by `nameKey`; the `customColumns` largest by open tasks
 * in the scope, before the filters, the rest folded into `other`). Each column is sorted by the
 * keyset (not urgent, deadline with none last, client name, created, id) and cut at 50, with its
 * total. With `column` and `after` it answers that column's next 50 after the cursor. `people`
 * are the distinct assignees of the client scope, before the assignee filter.
 *
 * Reads the tasks, buckets, groups and users tables directly: the read-only exception of
 * `modules/home`.
 */
export function globalBoardSql(q: GlobalBoardQuery): SQL {
  const inClients = (column: SQL) =>
    q.clientIds === null
      ? sql`true`
      : q.clientIds.length === 0
        ? sql`false`
        : sql`${column} in (${sql.join(
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
    with base as (
      select t.id, t.group_id, t.bucket_id, t.position, t.title, t.urgent, t.due_date, t.link,
        t.completed_at, t.source_message_id, t.created_at, t.updated_at, t.created_by,
        t.project_id, t.event_id,
        b.kind as bucket_kind, b.name as bucket_name,
        g.name as group_name, g.logo_key is not null as group_has_logo,
        g.updated_at as group_updated_at
      from tasks t
      join buckets b on b.id = t.bucket_id
      join groups g on g.id = t.group_id
      where ${inClients(sql`t.group_id`)} and ${completed}
    ),
    -- The scope's custom buckets, with their rank on their board (fixed buckets count too).
    custom_buckets as (
      select x.id, x.name, ${nameKey(sql`x.name`)} as key, x.rank
      from (
        select b.id, b.kind, ${spelling(sql`b.name`)} as name,
          row_number() over (partition by b.group_id order by b.position) as rank
        from buckets b
        where ${inClients(sql`b.group_id`)}
      ) x
      where x.kind = 'custom'
    ),
    bucket_sizes as (
      select bucket_id, count(*) as n from base where bucket_kind = 'custom' group by bucket_id
    ),
    -- One column per key: the most common spelling, the average rank, the open tasks.
    custom_columns as (
      select cb.key, mode() within group (order by cb.name collate "C") as name,
        avg(cb.rank) as pos, coalesce(sum(bs.n), 0) as size
      from custom_buckets cb
      left join bucket_sizes bs on bs.bucket_id = cb.id
      group by cb.key
    ),
    shown as (
      select key, name, pos from custom_columns
      order by size desc, pos, name collate "C", key collate "C"
      limit ${HOME_LIMITS.customColumns}
    ),
    scope as (
      select s.*,
        case
          when s.bucket_kind <> 'custom' then s.bucket_kind
          when sh.key is not null then ${CUSTOM_COLUMN_PREFIX} || sh.key
          else 'other'
        end as col
      from base s
      left join custom_buckets cb on cb.id = s.bucket_id
      left join shown sh on sh.key = cb.key
    ),
    filtered as (
      select s.*
      from scope s
      where ${assigneeFilter(q)} and ${mineFilter(q)} and ${urgent} and ${dueFilter(q)} and ${search} and ${onlyColumn}
        and ${projectFilter(q)}
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
          'knowledgeCount', ${linkedCountSql(sql`p.id`, sql`p.group_id`)},
          'sourceMessageId', p.source_message_id,
          'projectId', p.project_id,
          'eventId', p.event_id,
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
          'bucketName', p.bucket_name,
          -- 2026-10-17: a change the viewer has not seen (per card of the page, on
          -- notification_events_unseen_task_idx).
          'unseen', ${taskUnseenSql(q.viewerId, sql`p.id`)}
        )) order by p.col, p.rn), '[]'::json)
        from page p
      ) as tasks,
      (
        select coalesce(json_object_agg(c.col, c.total), '{}'::json)
        from (select col, count(*) as total from filtered group by col) c
      ) as totals,
      (
        select coalesce(json_agg(json_build_object('key', sh.key, 'name', sh.name)
          order by sh.pos, sh.name collate "C", sh.key collate "C"), '[]'::json)
        from shown sh
      ) as custom,
      (select count(*) > ${HOME_LIMITS.customColumns} from custom_columns) as folded,
      (
        select coalesce(json_agg(json_build_object('id', pu.id, 'name', pu.name)
          order by pu.name, pu.id), '[]'::json)
        from (
          select distinct ta.user_id
          from base s
          join task_assignees ta on ta.task_id = s.id
        ) x
        join "user" pu on pu.id = x.user_id
      ) as people
  `;
}

/** One card as the statement returns it: its column, the rows left from it, its key, the DTO. */
type CardJson = {
  col: string;
  remaining: number;
  cursor: Cursor;
  task: Omit<GlobalTaskDto, 'project' | 'event'> & {
    projectId: string | null;
    eventId: string | null;
  };
};

type Row = {
  tasks: CardJson[];
  totals: Record<string, number>;
  /** The custom columns shown, in board order. */
  custom: { key: string; name: string }[];
  /** Some custom names did not get a column: their tasks are in `other`. */
  folded: boolean;
  people: TaskPerson[];
};

type ColumnHead = Pick<GlobalColumn, 'id' | 'kind' | 'name'>;

const fixed = (kind: Exclude<GlobalColumn['kind'], 'custom'>): ColumnHead => ({
  id: kind,
  kind,
  name: null,
});

/**
 * The board's columns, in order: To do, the custom columns, Other steps (only when names were
 * folded), eGrant review, Client review, and Completed with `completed`.
 */
function columnHeads(q: GlobalBoardQuery, row: Row): ColumnHead[] {
  const heads: ColumnHead[] = [
    fixed('todo'),
    ...row.custom.map((c): ColumnHead => ({
      id: `${CUSTOM_COLUMN_PREFIX}${c.key}`,
      kind: 'custom',
      name: c.name,
    })),
    ...(row.folded ? [fixed('other')] : []),
    fixed('egrant_review'),
    fixed('client_review'),
    ...(q.completed ? [fixed('done')] : []),
  ];
  if (!q.column) return heads;
  // One column's next page; a custom column that lost its place since still answers, as itself.
  const head = heads.find((h) => h.id === q.column);
  if (head) return [head];
  return q.column.startsWith(CUSTOM_COLUMN_PREFIX)
    ? [{ id: q.column, kind: 'custom', name: q.column.slice(CUSTOM_COLUMN_PREFIX.length) }]
    : [fixed(q.column as Exclude<GlobalColumn['kind'], 'custom'>)];
}

const iso = (value: string) => new Date(value).toISOString();

export async function getGlobalBoard(db: Db, q: GlobalBoardQuery): Promise<GlobalBoard> {
  const [row] = [...(await db.execute<Row>(globalBoardSql(q)))];
  const { tasks, totals, people } = row!;
  // Phase 33 part P2: the cards' projects and events, one query for the page.
  const refs = await projectRefs(
    db,
    tasks.map((t) => t.task),
  );
  const columns = columnHeads(q, row!).map((head) => {
    const items = tasks.filter((t) => t.col === head.id);
    const last = items.at(-1);
    return {
      ...head,
      total: totals[head.id] ?? 0,
      // JSON timestamps come as `2026-10-01T10:00:00.123+00:00`; the DTOs use `toISOString()`.
      items: items.map(({ task: { projectId, eventId, ...t } }) => ({
        ...t,
        createdAt: iso(t.createdAt),
        updatedAt: iso(t.updatedAt),
        completedAt: t.completedAt === null ? null : iso(t.completedAt),
        groupUpdatedAt: iso(t.groupUpdatedAt),
        project: refs.project(projectId),
        event: refs.event(eventId),
      })),
      next: last && last.remaining > HOME_LIMITS.columnPage ? encodeCursor(last.cursor) : null,
    };
  });
  return { columns, people };
}
