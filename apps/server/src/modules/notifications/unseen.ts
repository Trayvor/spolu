import { sql, type SQL } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { SeenEvents, type SeenChangedEvent } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { userRoom } from '../../infra/realtime/rooms.js';
import { channelOnSql, groupModeSql } from './follows.js';
import { taskUnseenPredicate, ticketUnseenPredicate } from './unseen-kinds.js';

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
 */

const taskEvents = taskUnseenPredicate(sql`e.kind`, sql`e.payload`);
const ticketEvents = ticketUnseenPredicate(sql`e.kind`, sql`e.payload`);

/** Whether event `e` (a task's) would notify the user under their current mode for its group. */
function taskEventPassesSql(userId: string): SQL<boolean> {
  const mode = groupModeSql(userId, sql`e.group_id`);
  return sql<boolean>`(case when e.kind = 'chat.message' then ${mode} = 'all' else ${mode} <> 'off' end)`;
}

/** True when the task `taskId` (an SQL expression, e.g. `t.id`) has an unseen change for the user. */
export function taskUnseenSql(userId: string, taskId: SQL): SQL<boolean> {
  return sql<boolean>`(${channelOnSql(userId, 'tasks')} and exists (
    select 1 from notification_events e
    where e.user_id = ${userId} and ${taskEvents} and (e.payload ->> 'taskId') = ${taskId}
      and e.created_at > coalesce(
        (select s.seen_at from task_seen s where s.user_id = ${userId} and s.task_id = ${taskId}),
        '-infinity'::timestamptz)
      and ${taskEventPassesSql(userId)}
  ))`;
}

/** True when the ticket `ticketId` has an unseen change for the user. */
export function ticketUnseenSql(userId: string, ticketId: SQL): SQL<boolean> {
  return sql<boolean>`(${channelOnSql(userId, 'tickets')} and exists (
    select 1 from notification_events e
    where e.user_id = ${userId} and ${ticketEvents} and (e.payload ->> 'ticketId') = ${ticketId}
      and e.created_at > coalesce(
        (select s.seen_at from ticket_seen s where s.user_id = ${userId} and s.ticket_id = ${ticketId}),
        '-infinity'::timestamptz)
  ))`;
}

/**
 * The ids of the tasks with an unseen change for the user, one row each (`task_id`). May name a
 * deleted task: join `tasks`.
 */
export function unseenTaskIdsSql(userId: string): SQL {
  return sql`
    select x.task_id
    from (
      select (e.payload ->> 'taskId') as task_id, max(e.created_at) as last_at
      from notification_events e
      where e.user_id = ${userId} and ${taskEvents} and ${channelOnSql(userId, 'tasks')}
        and ${taskEventPassesSql(userId)}
      group by 1
    ) x
    left join task_seen s on s.user_id = ${userId} and s.task_id = x.task_id
    where s.seen_at is null or x.last_at > s.seen_at
  `;
}

/** The ids of the tickets with an unseen change for the user (`ticket_id`). Join `tickets`. */
export function unseenTicketIdsSql(userId: string): SQL {
  return sql`
    select x.ticket_id
    from (
      select (e.payload ->> 'ticketId') as ticket_id, max(e.created_at) as last_at
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
