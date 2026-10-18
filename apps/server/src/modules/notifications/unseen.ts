import { sql, type SQL } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import {
  SeenEvents,
  type SeenChangedEvent,
  type UnseenMark,
  type UnseenSummary,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { userRoom } from '../../infra/realtime/rooms.js';
import { channelOnSql, groupModeSql } from './follows.js';
import {
  list,
  TASK_MESSAGE_KINDS,
  TICKET_MESSAGE_KINDS,
  taskUnseenPredicate,
  ticketUnseenPredicate,
} from './unseen-kinds.js';
import { summarizeUnseen, type UnseenEventRow } from './unseen-summary.js';

/**
 * Unseen changes (2026-10-17, see docs/superpowers/specs/2026-10-17-unseen-changes-design.md): a
 * task or ticket has one for a user when a counted notification event of it for them
 * (`unseen-kinds.ts`) was created after they last opened it (`task_seen`, `ticket_seen`) and still
 * passes delivery's mode and channel rules, as `follows.ts` mirrors them: a task's event needs a
 * tasks channel that is not None and a group mode that is not Off, a task chat's plain message
 * All messages; a ticket's event only a tickets channel that is not None. (A recipient whose
 * channel was None got no row at all.) The fragments read this module's tables only; the caller
 * joins its own `tasks` or `tickets` for what still exists.
 *
 * Every fragment reads `notification_events_unseen_task_idx` (or `_ticket_idx`): the user's
 * counted events of one task, newest last. Events older than 30 days are purged, so a change
 * older than that no longer counts.
 *
 * 2026-10-18: an item is marked `message` (a yellow ring) when its unseen changes include a
 * message in its chat (`TASK_MESSAGE_KINDS`, `TICKET_MESSAGE_KINDS`), else `change` (a dot); the
 * summaries list what those changes were.
 */

const taskEvents = taskUnseenPredicate(sql`e.kind`, sql`e.payload`);
const ticketEvents = ticketUnseenPredicate(sql`e.kind`, sql`e.payload`);

/** Whether event `e` (a task's) would notify the user under their current mode for its group. */
function taskEventPassesSql(userId: string): SQL<boolean> {
  const mode = groupModeSql(userId, sql`e.group_id`);
  return sql<boolean>`(case when e.kind = 'chat.message' then ${mode} = 'all' else ${mode} <> 'off' end)`;
}

/**
 * The user's unseen events of the task `taskId` (an SQL expression, e.g. `t.id`): after their
 * last open, passing the mode. The caller adds the channel check.
 */
function taskUnseenEventsWhere(userId: string, taskId: SQL): SQL {
  return sql`e.user_id = ${userId} and ${taskEvents} and (e.payload ->> 'taskId') = ${taskId}
      and e.created_at > coalesce(
        (select s.seen_at from task_seen s where s.user_id = ${userId} and s.task_id = ${taskId}),
        '-infinity'::timestamptz)
      and ${taskEventPassesSql(userId)}`;
}

function ticketUnseenEventsWhere(userId: string, ticketId: SQL): SQL {
  return sql`e.user_id = ${userId} and ${ticketEvents} and (e.payload ->> 'ticketId') = ${ticketId}
      and e.created_at > coalesce(
        (select s.seen_at from ticket_seen s where s.user_id = ${userId} and s.ticket_id = ${ticketId}),
        '-infinity'::timestamptz)`;
}

/** `message` when one of the events in scope (`e`) is of `messageKinds`, else `change`. */
const markOf = (messageKinds: readonly string[]) =>
  sql`case when bool_or(e.kind in (${list(messageKinds)})) then 'message' else 'change' end`;

/**
 * How the task `taskId` (an SQL expression, e.g. `t.id`) is marked for the user: `message`,
 * `change`, or null when it has no unseen change.
 */
export function taskUnseenSql(userId: string, taskId: SQL): SQL<UnseenMark | null> {
  return sql<UnseenMark | null>`(case when ${channelOnSql(userId, 'tasks')} then (
    select ${markOf(TASK_MESSAGE_KINDS)}
    from notification_events e
    where ${taskUnseenEventsWhere(userId, taskId)}
    having count(*) > 0
  ) end)`;
}

/** How the ticket `ticketId` is marked for the user, or null. */
export function ticketUnseenSql(userId: string, ticketId: SQL): SQL<UnseenMark | null> {
  return sql<UnseenMark | null>`(case when ${channelOnSql(userId, 'tickets')} then (
    select ${markOf(TICKET_MESSAGE_KINDS)}
    from notification_events e
    where ${ticketUnseenEventsWhere(userId, ticketId)}
    having count(*) > 0
  ) end)`;
}

/** The newest unseen events a summary reads; more only adds to a count nobody reads exactly. */
const SUMMARY_EVENTS = 500;

function summarySql(channelOn: SQL, where: SQL): SQL {
  return sql`
    select e.kind, e.payload, e.created_at,
      to_char(e.created_at at time zone 'Europe/Bratislava', 'YYYY-MM-DD') as day
    from notification_events e
    where ${channelOn} and ${where}
    order by e.created_at desc
    limit ${SUMMARY_EVENTS}
  `;
}

/** The user's unseen events of the task, newest first, for its summary. */
export function taskSummarySql(userId: string, taskId: string): SQL {
  return summarySql(
    channelOnSql(userId, 'tasks'),
    taskUnseenEventsWhere(userId, sql`${taskId}::text`),
  );
}

/** The user's unseen events of the ticket, newest first, for its summary. */
export function ticketSummarySql(userId: string, ticketId: string): SQL {
  return summarySql(
    channelOnSql(userId, 'tickets'),
    ticketUnseenEventsWhere(userId, sql`${ticketId}::text`),
  );
}

async function summaryRows(db: Db, query: SQL): Promise<UnseenEventRow[]> {
  const rows = await db.execute<{
    kind: string;
    payload: Record<string, unknown>;
    created_at: string | Date;
    day: string;
  }>(query);
  return [...rows].map((r) => ({
    kind: r.kind,
    payload: r.payload ?? {},
    createdAt: new Date(r.created_at),
    day: r.day,
  }));
}

/**
 * What changed in the task since the user last opened it (2026-10-18): their own unseen events,
 * as summary lines. The caller checked they may read the task now.
 */
export async function taskUnseenSummary(
  db: Db,
  userId: string,
  taskId: string,
): Promise<UnseenSummary> {
  return summarizeUnseen(await summaryRows(db, taskSummarySql(userId, taskId)));
}

/** What changed in the ticket since the user last opened it. The caller checked they read it. */
export async function ticketUnseenSummary(
  db: Db,
  userId: string,
  ticketId: string,
): Promise<UnseenSummary> {
  return summarizeUnseen(await summaryRows(db, ticketSummarySql(userId, ticketId)));
}

/** The task message kinds other than a plain chat message, whose mode rule differs. */
const TASK_MESSAGE_KINDS_BUT_CHAT = TASK_MESSAGE_KINDS.filter((k) => k !== 'chat.message');

/**
 * The ids of the tasks with an unseen change for the user, one row each (`task_id`), and
 * whether those changes include a chat message (`message`). May name a deleted task: join `tasks`.
 *
 * 2026-10-18: the events are first reduced to one row per task and group (the newest plain chat
 * message, the newest other event, the newest other message), and the user's mode is looked up
 * once per such row, not once per event (an admin collects thousands of `chat.message` events a
 * month). The mode then picks the dates, as `taskEventPassesSql` does per event: All counts both,
 * Off nothing, Mentions and replies all but the plain chat messages.
 *
 * `userId` is a user id (bound) or an SQL expression naming one (2026-10-19: a lateral join's
 * `wa.id`, the admin workload card). The fragment's own aliases are `e`, `s`, `x`, `y`, `z`.
 */
export function unseenTaskIdsSql(userId: string | SQL): SQL {
  const passing = (chat: SQL, other: SQL) =>
    sql`(case y.mode when 'off' then null when 'all' then greatest(${chat}, ${other}) else ${other} end)`;
  return sql`
    select x.task_id,
      (x.message_at is not null and (s.seen_at is null or x.message_at > s.seen_at)) as message
    from (
      select y.task_id, max(${passing(sql`y.chat_at`, sql`y.other_at`)}) as last_at,
        max(${passing(sql`y.chat_at`, sql`y.message_at`)}) as message_at
      from (
        select z.*, ${groupModeSql(userId, sql`z.group_id`)} as mode
        from (
          select (e.payload ->> 'taskId') as task_id, e.group_id,
            max(e.created_at) filter (where e.kind = 'chat.message') as chat_at,
            max(e.created_at) filter (where e.kind <> 'chat.message') as other_at,
            max(e.created_at) filter (
              where e.kind in (${list(TASK_MESSAGE_KINDS_BUT_CHAT)})) as message_at
          from notification_events e
          where e.user_id = ${userId} and ${taskEvents} and ${channelOnSql(userId, 'tasks')}
          group by 1, 2
        ) z
      ) y
      group by 1
    ) x
    left join task_seen s on s.user_id = ${userId} and s.task_id = x.task_id
    where x.last_at is not null and (s.seen_at is null or x.last_at > s.seen_at)
  `;
}

/**
 * The ids of the tickets with an unseen change for the user (`ticket_id`), and whether those
 * include a message (`message`). Join `tickets`. `userId` is a user id (bound) or an SQL
 * expression naming one, as in `unseenTaskIdsSql`.
 */
export function unseenTicketIdsSql(userId: string | SQL): SQL {
  return sql`
    select x.ticket_id,
      (x.message_at is not null and (s.seen_at is null or x.message_at > s.seen_at)) as message
    from (
      select (e.payload ->> 'ticketId') as ticket_id, max(e.created_at) as last_at,
        max(e.created_at) filter (where e.kind in (${list(TICKET_MESSAGE_KINDS)})) as message_at
      from notification_events e
      where e.user_id = ${userId} and ${ticketEvents} and ${channelOnSql(userId, 'tickets')}
      group by 1
    ) x
    left join ticket_seen s on s.user_id = ${userId} and s.ticket_id = x.ticket_id
    where s.seen_at is null or x.last_at > s.seen_at
  `;
}

/** The user opened the task: its changes so far are seen. The caller checked they may read it. */
export async function markTaskSeen(db: Db, userId: string, taskId: string): Promise<void> {
  await db.execute(sql`
    insert into task_seen (user_id, task_id, seen_at) values (${userId}, ${taskId}, now())
    on conflict (user_id, task_id) do update set seen_at = excluded.seen_at
  `);
}

/** The user opened the ticket: its changes so far are seen. The caller checked they may read it. */
export async function markTicketSeen(db: Db, userId: string, ticketId: string): Promise<void> {
  await db.execute(sql`
    insert into ticket_seen (user_id, ticket_id, seen_at) values (${userId}, ${ticketId}, now())
    on conflict (user_id, ticket_id) do update set seen_at = excluded.seen_at
  `);
}

/**
 * The user opened the project (2026-10-18): a mention in its description from before is read on
 * the Mentions card. The caller checked they may read it.
 */
export async function markProjectSeen(db: Db, userId: string, projectId: string): Promise<void> {
  await db.execute(sql`
    insert into project_seen (user_id, project_id, seen_at) values (${userId}, ${projectId}, now())
    on conflict (user_id, project_id) do update set seen_at = excluded.seen_at
  `);
}

/** The user opened the knowledge item (2026-10-18), like `markProjectSeen`. */
export async function markKnowledgeSeen(db: Db, userId: string, itemId: string): Promise<void> {
  await db.execute(sql`
    insert into knowledge_seen (user_id, item_id, seen_at) values (${userId}, ${itemId}, now())
    on conflict (user_id, item_id) do update set seen_at = excluded.seen_at
  `);
}

/**
 * A ticket without a client got its first riešiteľ: every admin heard about it, and none of them
 * needs to look any more, so its changes so far are seen for all of them. Call it before the new
 * riešiteľ's own `ticket.assigned` is recorded, which then still counts for them.
 */
export async function clearTicketUnseenForAdmins(db: Db, ticketId: string): Promise<void> {
  await db.execute(sql`
    insert into ticket_seen (user_id, ticket_id, seen_at)
    select u.id, ${ticketId}, now() from "user" u where u.role = 'admin' and u.disabled_at is null
    on conflict (user_id, ticket_id) do update set seen_at = excluded.seen_at
  `);
}

/**
 * Tells every socket of the user that they opened a task or a ticket, so their other devices
 * refetch the unseen marks and counts (like `chat:read`). Call after the seen mark is written.
 */
export function emitSeen(io: SocketIOServer, userId: string, event: SeenChangedEvent): void {
  io.to(userRoom(userId)).emit(SeenEvents.changed, event);
}
