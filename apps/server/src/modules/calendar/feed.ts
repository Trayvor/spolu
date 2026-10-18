import { createHash } from 'node:crypto';
import {
  CALENDAR_FEED_LIMITS,
  MENTION_RE,
  type CalendarFeedInclude,
  type SessionUser,
  type UserLanguage,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { clientGroupIds } from '../groups/memberships.js';
import { activeGroupLabels } from '../groups/service.js';
import { feedCalls } from '../knowledge/feed.js';
import { canReadItem } from '../knowledge/policy.js';
import { managedGroupIdsOf } from '../knowledge/scope.js';
import { mentionNames } from '../knowledge/service.js';
import { feedEvents } from '../projects/feed.js';
import { canReadProjects } from '../projects/policy.js';
import type { IcsEvent } from '../reminders/ics.js';
import { buildIcsFeed } from '../reminders/ics.js';
import { feedAssignedDeadlines } from '../tasks/feed.js';
import { canUseBoard } from '../tasks/policy.js';
import { bratislavaDay } from '../tasks/reminders.js';
import { meetingDurations } from '../teams/service.js';
import { isAdmin } from '../users/policy.js';

const DAY_MS = 24 * 60 * 60_000;

/** `day` (`YYYY-MM-DD`) plus `n` calendar days. */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** At most `max` whole characters of the trimmed text. */
const cut = (text: string, max: number) => [...text.trim()].slice(0, max).join('');

type FeedLog = { warn(obj: object, msg: string): void };

/**
 * The person's calendar feed (ADR 0051), built for who they are now: what they may read at this
 * moment, never what was decided when the link was made.
 *
 * - Readable groups: an admin every active group, a client their client groups (both without
 *   deactivated groups, ADR 0038).
 * - Events and calls: an admin's own clients (`managedGroupIdsOf`, nothing when they manage
 *   none), a client's readable groups. Deadlines: the open tasks assigned to the person in the
 *   readable groups (owner decision 2026-10-19).
 * - Every row passes its module's read rule again (`canReadProjects`, `canUseBoard`,
 *   `canReadItem`); the SQL filter is only the fast path.
 *
 * At most seven statements whatever the size. The text is deterministic (each event stamped
 * with its own change time, sorted by start and UID), so its hash is the ETag.
 */
export async function buildFeedFor(
  db: Db,
  user: SessionUser & { language: UserLanguage },
  include: CalendarFeedInclude,
  publicUrl: string,
  now: Date = new Date(),
  log?: FeedLog,
): Promise<{ text: string; etag: string }> {
  const admin = isAdmin(user);
  const texts = serverTexts(user.language);
  const t = texts.calendarFeed;
  const base = publicUrl.replace(/\/+$/, '');
  const limit = CALENDAR_FEED_LIMITS.rowsPerSource;

  // Who reads what, read fresh.
  let actorGroupIds: string[] = [];
  let readable: string[];
  let scope: string[];
  let labels = new Map<string, string>();
  if (admin) {
    labels = await activeGroupLabels(db, 'all');
    readable = [...labels.keys()];
    scope = (await managedGroupIdsOf(db, user.id)).filter((id) => labels.has(id));
  } else {
    actorGroupIds = await clientGroupIds(db, user.id);
    readable = actorGroupIds;
    scope = actorGroupIds;
  }

  const today = bratislavaDay(now);
  const from = addDays(today, -CALENDAR_FEED_LIMITS.pastDays);
  const to = addDays(today, CALENDAR_FEED_LIMITS.aheadDays);
  const [events, deadlines, calls] = await Promise.all([
    include.events ? feedEvents(db, { groupIds: scope, from, to, limit }) : [],
    include.tasks
      ? feedAssignedDeadlines(db, { userId: user.id, groupIds: readable, from, to, limit })
      : [],
    include.calls
      ? feedCalls(db, {
          groupIds: scope,
          includeAdminsOnly: admin,
          from: new Date(now.getTime() - CALENDAR_FEED_LIMITS.pastDays * DAY_MS),
          to: new Date(now.getTime() + CALENDAR_FEED_LIMITS.aheadDays * DAY_MS),
          limit,
        })
      : [],
  ]);
  for (const [source, rows] of [
    ['events', events],
    ['tasks', deadlines],
    ['calls', calls],
  ] as const) {
    if (rows.length >= limit) log?.warn({ userId: user.id, source }, 'calendar feed source cut');
  }

  // The rule of each row's module, again.
  const okEvents = events.filter((e) => canReadProjects(user, e.groupId, actorGroupIds));
  const okDeadlines = deadlines.filter((d) => canUseBoard(user, d.groupId, actorGroupIds));
  const okCalls = calls.filter((c) => canReadItem(user, c, actorGroupIds));

  const [durations, names] = await Promise.all([
    meetingDurations(
      db,
      okCalls.map((c) => c.id),
    ),
    mentionNames(db, [
      ...okEvents.map((e) => ({ groupId: e.groupId, body: e.description })),
      ...okDeadlines.map((d) => ({ groupId: d.groupId, body: d.description })),
    ]),
  ]);

  /** The description's mentions as names of the item's group (`@?` for anyone else). */
  const plain = (groupId: string, body: string) =>
    body.replace(MENTION_RE, (_, id: string) =>
      id === 'all' ? '@all' : `@${names.get(groupId)?.get(id) ?? '?'}`,
    );
  const describe = (groupId: string, body: string, url: string) => {
    const text = cut(plain(groupId, body), CALENDAR_FEED_LIMITS.description);
    return text ? `${text}\n\n${url}` : url;
  };
  const summary = (groupId: string, text: string) =>
    admin ? t.withGroup(labels.get(groupId) ?? '', text) : text;

  const out: { key: number; event: IcsEvent }[] = [];
  const dayKey = (date: string) => Date.parse(`${date}T00:00:00Z`);
  for (const e of okEvents) {
    const url = `${base}/groups/${e.groupId}/overview?event=${e.id}`;
    out.push({
      key: dayKey(e.occursOn),
      event: {
        uid: `event-${e.id}@spolu`,
        date: e.occursOn,
        title: summary(e.groupId, t.eventSummary(e.projectName, e.name)),
        description: describe(e.groupId, e.description, url),
        url,
        updatedAt: e.updatedAt,
      },
    });
  }
  for (const d of okDeadlines) {
    const url = `${base}/groups/${d.groupId}/tasks/${d.id}`;
    out.push({
      key: dayKey(d.dueDate),
      event: {
        // The UID the one-off reminders export gives the deadline: one event in the calendar.
        uid: `task-${d.id}-deadline@spolu`,
        date: d.dueDate,
        title: summary(d.groupId, texts.notifications.deadlineEvent(d.title)),
        description: describe(d.groupId, d.description, url),
        url,
        updatedAt: d.updatedAt,
      },
    });
  }
  for (const c of okCalls) {
    const url = `${base}/groups/${c.groupId}/knowledge?k=${c.id}`;
    const minutes = durations.get(c.id) ?? CALENDAR_FEED_LIMITS.callMinutes;
    out.push({
      key: c.startsAt.getTime(),
      event: {
        uid: `call-${c.id}@spolu`,
        start: c.startsAt,
        end: new Date(c.startsAt.getTime() + minutes * 60_000),
        ...(c.meetingUrl ? { location: c.meetingUrl } : {}),
        alarm: false,
        title: summary(c.groupId, t.callSummary(c.title)),
        // Only the links: no notes, transcript or summary (the calendar may be shared).
        description: c.meetingUrl ? `${url}\n${c.meetingUrl}` : url,
        url,
        updatedAt: c.updatedAt,
      },
    });
  }
  out.sort((a, b) => a.key - b.key || (a.event.uid < b.event.uid ? -1 : 1));

  const text = buildIcsFeed({ name: t.name(user.name), events: out.map((o) => o.event) });
  const etag = `"${createHash('sha256').update(text).digest('base64url').slice(0, 22)}"`;
  return { text, etag };
}
