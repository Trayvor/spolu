import { sql, type SQL } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import {
  NotificationEvents,
  NotificationSubjectKinds,
  type NotificationSubject,
  type NotificationSubjectKind,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { userRoom } from '../../infra/realtime/rooms.js';

/**
 * Read on open (2026-10-19, ADR 0060): opening a task, a ticket, a group chat, a project, a
 * knowledge item or a project event by any route reads the person's notification centre items
 * about it. An event's subject is a key computed from its kind and payload
 * (`notificationSubjectSql`), the same key the push's device tag names: a ticket's id first (a
 * mention in a ticket chat carries it), then a task's (its chat's messages too), a meeting's
 * knowledge item, a description mention's or a reminder's own subject, and last the chat channel
 * of a group chat message or thread reply. The partial index `notification_events_unread_subject_idx`
 * holds the unread items only, by person and key, so both the write and the lists' marks are one
 * index range.
 *
 * Kept apart from `centre.ts` so the schema can build the index from the same expression without
 * an import cycle.
 */

/** The subject key (`task:<id>`, `ticket:<id>`, ...) of event `kind`/`payload`, or null. */
export function notificationSubjectSql(kind: SQL, payload: SQL): SQL<string | null> {
  return sql<string | null>`(coalesce(
    'ticket:' || (${payload} ->> 'ticketId'),
    'task:' || (${payload} ->> 'taskId'),
    case when ${kind} like 'meeting.%' then 'knowledge:' || (${payload} ->> 'itemId') end,
    (${payload} ->> 'subjectKind') || ':' || (${payload} ->> 'subjectId'),
    'chat:' || (${payload} ->> 'channelId')
  ))`;
}

export const subjectKey = (subject: NotificationSubject) => `${subject.kind}:${subject.id}`;

/** The subject a key names, or null for none or an unknown kind. */
export function parseSubjectKey(key: string | null | undefined): NotificationSubject | null {
  if (!key) return null;
  const at = key.indexOf(':');
  const kind = key.slice(0, at);
  const id = key.slice(at + 1);
  if (at < 1 || id === '') return null;
  if (!(NotificationSubjectKinds as readonly string[]).includes(kind)) return null;
  return { kind: kind as NotificationSubjectKind, id };
}

/** The person's "Mark all as read" time, or -infinity: what is older is read. */
export const centreReadMarkSql = (userId: string) =>
  sql`coalesce((select s.read_at from notification_centre_state s where s.user_id = ${userId}), '-infinity'::timestamptz)`;

/**
 * The rows of `notification_events` aliased `alias` that are the person's unread centre items
 * (the partial index's predicate, then the mark).
 */
function unreadWhere(alias: string, userId: string): SQL {
  const a = sql.raw(alias);
  return sql`${a}.user_id = ${userId} and ${a}.in_centre and ${a}.read_at is null
    and ${a}.created_at > ${centreReadMarkSql(userId)}`;
}

const keyOf = (alias: string) => {
  const a = sql.raw(alias);
  return notificationSubjectSql(sql`${a}.kind`, sql`${a}.payload`);
};

/**
 * Whether the person has an unread centre item about the `kind` subject `id` (an SQL expression,
 * e.g. `p.id`): the lists' marks, one index probe per row of the page.
 */
export function unreadSubjectSql(
  userId: string,
  kind: NotificationSubjectKind,
  id: SQL,
): SQL<boolean> {
  return sql<boolean>`exists (
    select 1 from notification_events n
    where ${unreadWhere('n', userId)} and ${keyOf('n')} = ${`${kind}:`} || ${id}
  )`;
}

/**
 * The ids of the `kind` subjects the person has an unread centre item about (`subject_id`), one
 * row per item: the board's marks, driven by the person's unread items, not by the board.
 */
export function unreadSubjectIdsSql(userId: string, kind: NotificationSubjectKind): SQL {
  const prefix = `${kind}:`;
  return sql`
    select substr(${keyOf('n')}, ${prefix.length + 1}) as subject_id
    from notification_events n
    where ${unreadWhere('n', userId)} and left(${keyOf('n')}, ${prefix.length}) = ${prefix}
  `;
}

/** The write of `markSubjectRead`, apart for the plan check. */
export function markSubjectReadSql(userId: string, subject: NotificationSubject): SQL {
  return sql`
    update notification_events e set read_at = now()
    where ${unreadWhere('e', userId)} and ${keyOf('e')} = ${subjectKey(subject)}
    returning e.id
  `;
}

/**
 * The person opened the subject: their unread centre items about it are read from now on. Only
 * their own rows; the caller checked they may open it. Returns how many items it read.
 */
export async function markSubjectRead(
  db: Db,
  userId: string,
  subject: NotificationSubject,
): Promise<number> {
  return [...(await db.execute<{ id: string }>(markSubjectReadSql(userId, subject)))].length;
}

/**
 * `markSubjectRead`, then, when it read anything, `notifications:read` with the subject to the
 * person's own room: their bell's count drops, their lists drop the subject's mark.
 */
export async function readSubject(
  db: Db,
  io: SocketIOServer,
  userId: string,
  subject: NotificationSubject,
): Promise<void> {
  if ((await markSubjectRead(db, userId, subject)) === 0) return;
  io.to(userRoom(userId)).emit(NotificationEvents.read, { id: null, subject });
}
