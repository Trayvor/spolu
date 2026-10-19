import { sql, type SQL } from 'drizzle-orm';
import {
  NOTIFICATION_UNREAD_CAP,
  type MemberRole,
  type NotificationCentreState,
  type NotificationItem,
  type NotificationKind,
  type NotificationPage,
  type NotificationSubject,
  type SessionUser,
  type SnoozeLength,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { liveMessageParents } from '../chat/notify.js';
import { listMemberships } from '../groups/memberships.js';
import { getGroupLabels } from '../groups/service.js';
import { getTaskTitles } from '../tasks/task-service.js';
import { isAdmin } from '../users/policy.js';
import { getNotificationProfiles } from '../users/service.js';
import { notificationGroupOf } from './categories.js';
import { canSeeCentreItem } from './policy.js';
import { buildPushPayload } from './push-content.js';
import { centreReadMarkSql, notificationSubjectSql, parseSubjectKey } from './subject-read.js';

/**
 * The notification centre (UX review F2, 2026-10-18): a person's events that delivery marked
 * `in_centre`, newest first, rendered with the push texts and links; "Mark all as read" and the
 * push snooze live in `notification_centre_state`, one opened item in its event's `read_at`. Events are purged after 30 days (`jobs.ts`),
 * so the list reaches that far back.
 */

const TIME_ZONE = 'Europe/Bratislava';
/** "Do zajtra" ends at this hour of the next day in Bratislava. */
const TOMORROW_HOUR = 8;
const DEFAULT_PAGE = 30;

export class InvalidCentreCursorError extends Error {
  constructor() {
    super('Invalid notification cursor');
    this.name = 'InvalidCentreCursorError';
  }
}

type Cursor = { at: string; id: string };

const encodeCursor = (c: Cursor) => Buffer.from(JSON.stringify([c.at, c.id])).toString('base64url');

function decodeCursor(raw: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString());
  } catch {
    throw new InvalidCentreCursorError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    Number.isNaN(Date.parse(parsed[0])) ||
    typeof parsed[1] !== 'string'
  ) {
    throw new InvalidCentreCursorError();
  }
  return { at: parsed[0], id: parsed[1] };
}

/** The instant as ISO text with its microseconds (a JS Date would drop them and break paging). */
const isoSql = (column: SQL) =>
  sql<string>`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const readAtSql = centreReadMarkSql;

/** One page of the person's listed events, newest first (`notification_events_centre_idx`). */
export function centreListSql(userId: string, after: Cursor | null, limit: number): SQL {
  return sql`
    select e.id, e.kind, e.group_id, e.payload, ${isoSql(sql`e.created_at`)} as at,
      e.read_at is null and e.created_at > ${readAtSql(userId)} as unread
    from notification_events e
    where e.user_id = ${userId} and e.in_centre
      ${after ? sql`and (e.created_at, e.id) < (${after.at}::timestamptz, ${after.id}::text)` : sql``}
    order by e.created_at desc, e.id desc
    limit ${limit}
  `;
}

/**
 * The bell's number: the listed events after "Mark all as read" not opened one by one, counted
 * up to the cap.
 */
export function centreUnreadSql(userId: string): SQL {
  return sql`
    select count(*)::int as n from (
      select 1 from notification_events e
      where e.user_id = ${userId} and e.in_centre and e.read_at is null
        and e.created_at > ${readAtSql(userId)}
      limit ${NOTIFICATION_UNREAD_CAP}
    ) x
  `;
}

type ListRow = {
  id: string;
  kind: string;
  group_id: string | null;
  payload: Record<string, unknown> | null;
  at: string;
  unread: boolean;
};

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/**
 * A page of the actor's centre. The items are the events' push texts in the actor's language;
 * an item the actor may no longer see (`canSeeCentreItem`) or whose message was deleted is left
 * out, so a page may hold fewer than `limit` items while `nextCursor` goes on. Six queries
 * whatever the page size. Throws `InvalidCentreCursorError`.
 */
export async function listCentre(
  db: Db,
  actor: SessionUser,
  query: { limit?: number; cursor?: string },
): Promise<NotificationPage> {
  const limit = query.limit ?? DEFAULT_PAGE;
  const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
  const rows = [...(await db.execute<ListRow>(centreListSql(actor.id, after, limit + 1)))];
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor =
    rows.length > limit && last ? encodeCursor({ at: last.at, id: last.id }) : null;
  if (page.length === 0) return { items: [], nextCursor };

  const payloadOf = (r: ListRow) => r.payload ?? {};
  const groupIds = [...new Set(page.flatMap((r) => r.group_id ?? []))];
  const messageIds = page.flatMap((r) => str(payloadOf(r).messageId) ?? []);
  const taskIds = page.flatMap((r) => str(payloadOf(r).taskId) ?? []);
  const [profiles, memberships, labels, parents, titles] = await Promise.all([
    getNotificationProfiles(db, [actor.id]),
    isAdmin(actor) ? Promise.resolve([]) : listMemberships(db, actor.id),
    getGroupLabels(db, groupIds),
    liveMessageParents(db, messageIds),
    getTaskTitles(db, taskIds),
  ]);
  const lang = profiles.get(actor.id)?.language ?? 'sk';
  const roles = new Map<string, MemberRole>(memberships.map((m) => [m.groupId, m.role]));
  const now = new Date();
  const items: NotificationItem[] = [];
  for (const row of page) {
    const payload = payloadOf(row);
    const category = notificationGroupOf(row.kind, payload);
    if (!canSeeCentreItem(actor, { groupId: row.group_id, category }, roles)) continue;
    const messageId = str(payload.messageId);
    if (messageId !== null && !parents.has(messageId)) continue;
    const taskId = str(payload.taskId);
    const push = buildPushPayload({
      kind: row.kind as NotificationKind,
      payload,
      groupName: (row.group_id && labels.get(row.group_id)?.name) ?? '',
      taskTitle: taskId ? (titles.get(taskId) ?? null) : null,
      parentId: messageId ? (parents.get(messageId) ?? null) : null,
      lang,
      now,
    });
    items.push({
      id: row.id,
      kind: row.kind,
      title: push.title,
      body: push.body,
      url: push.url,
      createdAt: row.at,
      unread: row.unread,
    });
  }
  return { items, nextCursor };
}

/** The bell: the unread count and the snooze still running. Two indexed reads in one query. */
export async function getCentreState(db: Db, userId: string): Promise<NotificationCentreState> {
  const [row] = await db.execute<{ unread: number; snoozed_until: string | null }>(sql`
    select (${centreUnreadSql(userId)}) as unread,
      (select ${isoSql(sql`s.snoozed_until`)} from notification_centre_state s
        where s.user_id = ${userId} and s.snoozed_until > now()) as snoozed_until
  `);
  return { unread: row?.unread ?? 0, snoozedUntil: row?.snoozed_until ?? null };
}

/** "Mark all as read": every listed event up to now. */
export async function markCentreRead(db: Db, userId: string): Promise<void> {
  await db.execute(sql`
    insert into notification_centre_state (user_id, read_at) values (${userId}, now())
    on conflict (user_id) do update set read_at = excluded.read_at
  `);
}

/**
 * One item opened (2026-10-19), from the centre's list or a push click: read from now on. Only
 * the person's own event; null when they have none of that id (the route answers 404), else what
 * it was about (`subject-read.ts`, null for none), so the lists can drop that subject's mark.
 * Marking an item read again keeps its first time. One indexed write (primary key).
 */
export async function markCentreItemRead(
  db: Db,
  userId: string,
  eventId: string,
): Promise<{ subject: NotificationSubject | null } | null> {
  const [row] = await db.execute<{ subject: string | null }>(sql`
    update notification_events set read_at = coalesce(read_at, now())
    where id = ${eventId} and user_id = ${userId}
    returning ${notificationSubjectSql(sql`kind`, sql`payload`)} as subject
  `);
  return row ? { subject: parseSubjectKey(row.subject) } : null;
}

const SNOOZE_UNTIL: Record<SnoozeLength, SQL> = {
  hour: sql`now() + interval '1 hour'`,
  // The next calendar day in Bratislava, at 08:00 there (summer time or not).
  tomorrow: sql`(((now() at time zone ${TIME_ZONE})::date + 1) + make_time(${TOMORROW_HOUR}, 0, 0)) at time zone ${TIME_ZONE}`,
  week: sql`now() + interval '7 days'`,
};

/** "Stíšiť na 1 h / do zajtra / na týždeň"; null ends it. Returns the bell's state. */
export async function setSnooze(
  db: Db,
  userId: string,
  length: SnoozeLength | null,
): Promise<NotificationCentreState> {
  const until = length === null ? sql`null::timestamptz` : SNOOZE_UNTIL[length];
  await db.execute(sql`
    insert into notification_centre_state (user_id, snoozed_until) values (${userId}, ${until})
    on conflict (user_id) do update set snoozed_until = excluded.snoozed_until
  `);
  return getCentreState(db, userId);
}

/** Of `userIds`, those whose pushes are snoozed now (delivery skips their pushes). One query. */
export async function snoozedAmong(db: Db, userIds: string[]): Promise<Set<string>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Set();
  const rows = await db.execute<{ user_id: string }>(sql`
    select s.user_id from notification_centre_state s
    where s.user_id in (${sql.join(
      ids.map((id) => sql`${id}`),
      sql`, `,
    )}) and s.snoozed_until > now()
  `);
  return new Set([...rows].map((r) => r.user_id));
}
