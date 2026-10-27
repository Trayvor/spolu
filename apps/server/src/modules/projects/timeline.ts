import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import {
  TIMELINE_LIMITS,
  type EventItemsPage,
  type EventItemsQuery,
  type TimelineEventDto,
  type TimelineQuery,
  type TimelineResponse,
  type TimelineTaskRow,
  type TimelineTicketRow,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import {
  doneTasksOfEvent,
  openTasksOfEvent,
  tasksByEvents,
  type EventTaskRow,
} from '../tasks/by-event.js';
import {
  openTicketsOfEvent,
  resolvedTicketsOfEvent,
  ticketsByEvents,
  type EventTicketRow,
} from '../tickets/by-event.js';
import { getUserNames } from '../users/service.js';
import { colorOf } from './refs.js';
import { InvalidProjectCursorError } from './service.js';

/**
 * The timeline (Phase 33 part P4, spec §7.2, §7.3, decisions 14–16). Events in date order, same
 * day by creation, keyset on `(occurs_on, created_at, id)` both ways from an anchor day (today in
 * Bratislava by default). A page is at most four queries whatever its size: the events (with
 * their project's name and file count), `tasksByEvents`, `ticketsByEvents` and one batch of
 * assignee names. The projects module never reads `tasks` or `tickets` itself.
 */

/** Today in Bratislava, `YYYY-MM-DD` (spec §2: past, today and coming follow it). */
export function bratislavaDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(now);
}

// ── Cursors ────────────────────────────────────────────────────────────────────────────────────

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const stamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/);
const id = z.string().min(1).max(100);

const EventCursorSchema = z.tuple([day, stamp, id]);
const OpenTaskCursorSchema = z.tuple([z.boolean(), day.nullable(), stamp, id]);
const OpenTicketCursorSchema = z.tuple([stamp, id]);
/** The done pile merges both kinds: (done at, kind, id), newest first. */
const DoneCursorSchema = z.tuple([stamp, z.enum(['task', 'ticket']), id]);

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function decode<T>(schema: z.ZodType<T>, cursor: string): T {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new InvalidProjectCursorError();
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new InvalidProjectCursorError();
  return parsed.data;
}

// ── Rows ───────────────────────────────────────────────────────────────────────────────────────

type EventRow = {
  side: 'b' | 'a';
  id: string;
  name: string;
  occurs_on: string;
  created_at: string;
  source: 'manual' | 'egrant';
  project_id: string;
  project_name: string;
  files: number;
};

const toTaskRow = (row: EventTaskRow, names: Map<string, string>): TimelineTaskRow => ({
  id: row.id,
  title: row.title,
  dueDate: row.dueDate,
  urgent: row.urgent,
  completedAt: row.completedAt,
  assignees: row.assigneeIds.map((userId) => ({ id: userId, name: names.get(userId) ?? '' })),
});

const toTicketRow = (row: EventTicketRow): TimelineTicketRow => ({
  id: row.id,
  number: row.number,
  subject: row.subject,
  status: row.status,
});

/** One side of the page: up to `limit + 1` events before or from a key, nearest first. */
function side(
  groupId: string,
  query: Pick<TimelineQuery, 'project' | 'exclude' | 'test'>,
  dir: 'b' | 'a',
  bound: SQL,
  limit: number,
): SQL {
  const ids = (list: string[]) => sql`array[${sql.join(list, sql`, `)}]::text[]`;
  // Test projects (ADR 0073) join "all" only when asked for; a chosen one is always shown.
  const active =
    query.test === '1'
      ? sql`e.group_id = ${groupId} and p.status = 'active'`
      : sql`e.group_id = ${groupId} and p.status = 'active' and not p.is_test`;
  const scope = query.project
    ? sql`e.project_id = any(${ids(query.project)}) and e.group_id = ${groupId}`
    : query.exclude
      ? sql`${active} and not (e.project_id = any(${ids(query.exclude)}))`
      : active;
  const order =
    dir === 'b'
      ? sql`e.occurs_on desc, e.created_at desc, e.id desc`
      : sql`e.occurs_on, e.created_at, e.id`;
  return sql`(
    select ${dir} as side, e.id, e.name, e.occurs_on::text as occurs_on, e.source,
      to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
      e.project_id, p.name as project_name,
      (select count(*)::int from project_attachments f where f.event_id = e.id) as files
    from project_events e
    join projects p on p.id = e.project_id and p.group_id = e.group_id
    where ${scope} and ${bound}
    order by ${order}
    limit ${limit + 1})`;
}

/** The statement of one page's events, exported for the EXPLAIN check. */
export function timelineEventsSql(groupId: string, query: TimelineQuery, today: string): SQL {
  const limit = query.limit;
  if (query.before !== undefined && query.after !== undefined) {
    throw new InvalidProjectCursorError();
  }
  if (query.before !== undefined) {
    const [on, at, eventId] = decode(EventCursorSchema, query.before);
    const bound = sql`e.occurs_on <= ${on}::date
      and (e.occurs_on, e.created_at, e.id) < (${on}::date, ${at}::timestamptz, ${eventId})`;
    return side(groupId, query, 'b', bound, limit);
  }
  if (query.after !== undefined) {
    const [on, at, eventId] = decode(EventCursorSchema, query.after);
    const bound = sql`e.occurs_on >= ${on}::date
      and (e.occurs_on, e.created_at, e.id) > (${on}::date, ${at}::timestamptz, ${eventId})`;
    return side(groupId, query, 'a', bound, limit);
  }
  const anchor = query.around === 'today' ? today : query.around;
  return sql`${side(groupId, query, 'b', sql`e.occurs_on < ${anchor}::date`, limit)}
    union all
    ${side(groupId, query, 'a', sql`e.occurs_on >= ${anchor}::date`, limit)}`;
}

const cursorOf = (row: EventRow) => encode([row.occurs_on, row.created_at, row.id]);

/** One page of a client's timeline: all active projects, or one project's whole life. */
export async function getTimeline(
  db: Db,
  groupId: string,
  query: TimelineQuery,
): Promise<TimelineResponse> {
  const today = bratislavaDay(new Date());
  const limit = query.limit;
  const rows = [...(await db.execute<EventRow>(timelineEventsSql(groupId, query, today)))];
  const beforeRows = rows.filter((r) => r.side === 'b');
  const afterRows = rows.filter((r) => r.side === 'a');
  const moreBefore = beforeRows.length > limit;
  const moreAfter = afterRows.length > limit;
  const page = [...beforeRows.slice(0, limit).reverse(), ...afterRows.slice(0, limit)];
  // A page asked for one direction answers that direction's cursor only.
  const askedBefore = query.after === undefined;
  const askedAfter = query.before === undefined;
  const first = page[0];
  const last = page[page.length - 1];
  const before = askedBefore && moreBefore && first ? cursorOf(first) : null;
  const after = askedAfter && moreAfter && last ? cursorOf(last) : null;
  if (page.length === 0) return { events: [], before, after, today };

  const ids = page.map((r) => r.id);
  const [taskRows, ticketRows] = await Promise.all([
    tasksByEvents(db, groupId, ids, { openLimit: TIMELINE_LIMITS.openRows }),
    ticketsByEvents(db, groupId, ids, { openLimit: TIMELINE_LIMITS.openRows }),
  ]);
  const names = await getUserNames(db, [
    ...new Set([...taskRows.values()].flatMap((t) => t.open.flatMap((r) => r.assigneeIds))),
  ]);
  const events: TimelineEventDto[] = page.map((row) => {
    const tasks = taskRows.get(row.id);
    const tickets = ticketRows.get(row.id);
    return {
      id: row.id,
      name: row.name,
      occursOn: row.occurs_on,
      project: { id: row.project_id, name: row.project_name, color: colorOf(row.project_id) },
      fromEgrant: row.source === 'egrant',
      files: row.files,
      openTasks: (tasks?.open ?? []).map((r) => toTaskRow(r, names)),
      openTaskCount: tasks?.openCount ?? 0,
      openTickets: (tickets?.open ?? []).map(toTicketRow),
      openTicketCount: tickets?.openCount ?? 0,
      doneCount: (tasks?.doneCount ?? 0) + (tickets?.doneCount ?? 0),
    };
  });
  return { events, before, after, today };
}

/**
 * One page (20) of an event's open tasks, open tickets or done pile (completed tasks and resolved
 * tickets merged newest first) for the event sheet and the expanded pile. The caller checked the
 * event's client.
 */
export async function eventItems(
  db: Db,
  groupId: string,
  eventId: string,
  query: EventItemsQuery,
): Promise<EventItemsPage> {
  const size = TIMELINE_LIMITS.itemsPage;
  const named = async (rows: EventTaskRow[]) => {
    const names = await getUserNames(db, [...new Set(rows.flatMap((r) => r.assigneeIds))]);
    return rows.map((r) => toTaskRow(r, names));
  };
  if (query.kind === 'tasks') {
    const after = query.after ? decode(OpenTaskCursorSchema, query.after) : undefined;
    const rows = await openTasksOfEvent(db, groupId, eventId, {
      after: after && { urgent: after[0], dueDate: after[1], createdAt: after[2], id: after[3] },
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      tasks: await named(page),
      tickets: [],
      nextCursor:
        rows.length > size && last
          ? encode([last.urgent, last.dueDate, last.createdAt, last.id])
          : null,
    };
  }
  if (query.kind === 'tickets') {
    const after = query.after ? decode(OpenTicketCursorSchema, query.after) : undefined;
    const rows = await openTicketsOfEvent(db, groupId, eventId, {
      after: after && { createdAt: after[0], id: after[1] },
      limit: size + 1,
    });
    const page = rows.slice(0, size);
    const last = page[page.length - 1];
    return {
      tasks: [],
      tickets: page.map(toTicketRow),
      nextCursor: rows.length > size && last ? encode([last.createdAt, last.id]) : null,
    };
  }
  // The done pile: both lists from the same key, merged by (done at desc, tasks before tickets,
  // id desc). After a task, the tickets of that instant are still to come; after a ticket, the
  // tasks of that instant were shown already.
  const after = query.after ? decode(DoneCursorSchema, query.after) : undefined;
  const [doneTasks, doneTickets] = await Promise.all([
    doneTasksOfEvent(db, groupId, eventId, {
      before: after && (after[1] === 'task' ? { at: after[0], id: after[2] } : { at: after[0] }),
      limit: size + 1,
    }),
    resolvedTicketsOfEvent(db, groupId, eventId, {
      before:
        after &&
        (after[1] === 'ticket'
          ? { at: after[0], id: after[2] }
          : { at: after[0], inclusive: true }),
      limit: size + 1,
    }),
  ]);
  type Done = {
    at: string;
    kind: 'task' | 'ticket';
    id: string;
    task?: EventTaskRow;
    ticket?: EventTicketRow;
  };
  const rank = (d: Done) => (d.kind === 'task' ? 0 : 1);
  const merged: Done[] = [
    ...doneTasks.map((t): Done => ({ at: t.completedAt!, kind: 'task', id: t.id, task: t })),
    ...doneTickets.map((t): Done => ({ at: t.doneAt!, kind: 'ticket', id: t.id, ticket: t })),
  ].sort((x, y) => {
    if (x.at !== y.at) return x.at < y.at ? 1 : -1;
    if (x.kind !== y.kind) return rank(x) - rank(y);
    return x.id < y.id ? 1 : x.id > y.id ? -1 : 0;
  });
  const page = merged.slice(0, size);
  const last = page[page.length - 1];
  return {
    tasks: await named(page.flatMap((d) => (d.task ? [d.task] : []))),
    tickets: page.flatMap((d) => (d.ticket ? [toTicketRow(d.ticket)] : [])),
    nextCursor: merged.length > size && last ? encode([last.at, last.kind, last.id]) : null,
  };
}
