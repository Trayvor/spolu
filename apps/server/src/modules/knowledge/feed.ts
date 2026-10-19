import { sql, type SQL } from 'drizzle-orm';
import { CALENDAR_FEED_LIMITS, type Visibility } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * A call (a `meeting` item) as the personal calendar feed shows it (ADR 0051): no body, notes,
 * transcript or summary, only what the calendar event needs.
 */
export type FeedCallRow = {
  id: string;
  groupId: string;
  title: string;
  visibility: Visibility;
  startsAt: Date;
  meetingUrl: string | null;
  updatedAt: Date;
};

export type FeedCallsQuery = {
  groupIds: string[];
  /** false leaves admins-only calls out in SQL (a client's feed). */
  includeAdminsOnly: boolean;
  /** `starts_at` in `[from, to)`. */
  from: Date;
  to: Date;
  limit?: number;
};

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"';

/**
 * The calls of `groupIds` starting in `[from, to)`, by start and id, at most `limit`. Every call
 * of a recurring series is its own item (ADR 0049), so each one is a row. An item in an
 * admins-only folder is admins-only itself (the folders' rule). `groupIds` must not be empty.
 */
export function feedCallsSql(q: FeedCallsQuery): SQL {
  return sql`
    select i.id, i.group_id, i.title, i.visibility,
      to_char(m.starts_at at time zone 'UTC', ${ISO}) as starts_at, m.meeting_url,
      to_char(i.updated_at at time zone 'UTC', ${ISO}) as updated_at
    from knowledge_meetings m
    join knowledge_items i on i.id = m.item_id
    where m.starts_at >= ${q.from.toISOString()}::timestamptz
      and m.starts_at < ${q.to.toISOString()}::timestamptz
      and i.group_id = any(${sql`array[${sql.join(q.groupIds, sql`, `)}]::text[]`})
      and i.type = 'meeting'
      ${q.includeAdminsOnly ? sql`` : sql`and i.visibility = 'public'`}
    order by m.starts_at, i.id
    limit ${q.limit ?? CALENDAR_FEED_LIMITS.rowsPerSource}`;
}

/** See `feedCallsSql`; one statement, none for no groups. */
export async function feedCalls(db: Db, q: FeedCallsQuery): Promise<FeedCallRow[]> {
  if (q.groupIds.length === 0) return [];
  const rows = await db.execute<{
    id: string;
    group_id: string;
    title: string;
    visibility: Visibility;
    starts_at: string;
    meeting_url: string | null;
    updated_at: string;
  }>(feedCallsSql(q));
  return [...rows].map((r) => ({
    id: r.id,
    groupId: r.group_id,
    title: r.title,
    visibility: r.visibility,
    startsAt: new Date(r.starts_at),
    meetingUrl: r.meeting_url,
    updatedAt: new Date(r.updated_at),
  }));
}
