import { sql, type SQL } from 'drizzle-orm';
import { HOME_MEETING_LIMITS, type HomeMeeting, type HomeMeetings } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { meetingNotifiesSql } from '../notifications/follows.js';
import { remindsUserSql } from '../reminders/service.js';
import { managedGroupIdsOf } from './scope.js';

// Phase 30: the dashboard's Meetings card, for admins (they read every item).

const DAY_MS = 24 * 60 * 60 * 1000;

type Row = {
  id: string;
  group_id: string;
  group_name: string;
  title: string;
  starts_at: string;
  has_summary: boolean;
  total: number;
};

const toMeeting = (row: Row): HomeMeeting => ({
  id: row.id,
  groupId: row.group_id,
  groupName: row.group_name,
  title: row.title,
  startsAt: row.starts_at,
  hasSummary: row.has_summary,
});

/**
 * One list: meetings in `scope` that the admin `follows` matching `where`, in `order`, with the
 * count before the limit.
 */
function listSql(scope: SQL, follows: SQL, where: SQL, order: SQL): SQL {
  return sql`
    select k.id, k.group_id, g.name as group_name, k.title,
           to_char(m.starts_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as starts_at,
           m.summary is not null as has_summary,
           (count(*) over ())::int as total
    from knowledge_meetings m
    join knowledge_items k on k.id = m.item_id
    join groups g on g.id = k.group_id
    where ${scope} and ${where} and ${follows}
    order by ${order}
    limit ${HOME_MEETING_LIMITS.items}`;
}

/**
 * The admin's Meetings card: meetings of the clients they manage (every client when they manage
 * none) starting in the next 7 days, soonest first, and those of the last 30 days without a
 * summary, newest first; 10 each, with the counts. Reads `knowledge_meetings_starts_at_idx`.
 *
 * Only meetings the admin gets meeting notifications for (2026-10-17, the dashboard follows the
 * notification settings): their Meetings channel is not None, and their mode for the client is
 * All messages (they hear its scheduling) or they get the meeting's reminder (which passes every
 * mode). `meetingNotifiesSql` is the notifications module's mirror of delivery.
 */
export async function dashboardMeetings(
  db: Db,
  adminId: string,
  now: Date = new Date(),
): Promise<HomeMeetings> {
  const managed = await managedGroupIdsOf(db, adminId);
  const follows = meetingNotifiesSql(adminId, sql`k.group_id`, remindsUserSql(adminId, sql`k.id`));
  const scope =
    managed.length === 0
      ? sql`true`
      : sql`k.group_id in (${sql.join(
          managed.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const ahead = new Date(now.getTime() + HOME_MEETING_LIMITS.aheadDays * DAY_MS);
  const since = new Date(now.getTime() - HOME_MEETING_LIMITS.pastDays * DAY_MS);
  const [upcoming, unsummarized] = await Promise.all([
    db.execute<Row>(
      listSql(
        scope,
        follows,
        sql`m.starts_at >= ${now.toISOString()}::timestamptz and m.starts_at < ${ahead.toISOString()}::timestamptz`,
        sql`m.starts_at asc, k.id`,
      ),
    ),
    db.execute<Row>(
      listSql(
        scope,
        follows,
        sql`m.starts_at < ${now.toISOString()}::timestamptz and m.starts_at >= ${since.toISOString()}::timestamptz and m.summary is null`,
        sql`m.starts_at desc, k.id`,
      ),
    ),
  ]);
  const up = [...upcoming];
  const past = [...unsummarized];
  return {
    upcomingTotal: up[0]?.total ?? 0,
    upcoming: up.map(toMeeting),
    unsummarizedTotal: past[0]?.total ?? 0,
    unsummarized: past.map(toMeeting),
  };
}
