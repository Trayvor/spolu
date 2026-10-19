import { sql, type SQL } from 'drizzle-orm';
import type {
  WeeklySummaryArchiveItem,
  WeeklySummaryArchiveQuery,
  WeeklySummaryContent,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { escapeLike, foldSql, normalizeSearch } from '../../infra/text/search.js';
import { getNotificationProfiles } from '../users/service.js';
import type { SummaryRow } from './service.js';

/**
 * The archive of work reports (Archív prehľadov, spec §7.3): every summary but `preparing`,
 * newest window first, keyset on `(window_end, id)`. A report matches a day range when its
 * window overlaps it (Bratislava days). The text filter reads the trigram index on the folded
 * `search_text`, which is never returned. Bounded and indexed: one client and a range read
 * `weekly_summaries_group_window_idx`, all clients `weekly_summaries_window_idx`.
 */

export type ArchiveCursor = { end: string; id: string };

export class InvalidArchiveCursorError extends Error {
  constructor() {
    super('Invalid cursor');
    this.name = 'InvalidArchiveCursorError';
  }
}

export function encodeArchiveCursor(c: ArchiveCursor): string {
  return Buffer.from(JSON.stringify([c.end, c.id])).toString('base64url');
}

export function decodeArchiveCursor(cursor: string): ArchiveCursor {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === 'string' &&
      typeof value[1] === 'string' &&
      !Number.isNaN(Date.parse(value[0]))
    ) {
      return { end: value[0], id: value[1] };
    }
  } catch {
    // falls through
  }
  throw new InvalidArchiveCursorError();
}

const STATUS_FILTER: Record<WeeklySummaryArchiveQuery['status'], SQL> = {
  sent: sql`s.status = 'sent'`,
  unsent: sql`s.status in ('draft', 'sending', 'skipped')`,
  all: sql`s.status <> 'preparing'`,
};

export function listArchiveSql(
  query: Omit<WeeklySummaryArchiveQuery, 'cursor'>,
  cursor: ArchiveCursor | null,
  limit: number,
): SQL {
  const conditions: SQL[] = [STATUS_FILTER[query.status]];
  if (query.groupId) conditions.push(sql`s.group_id = ${query.groupId}`);
  if (query.from) {
    conditions.push(
      sql`s.window_end > (${query.from}::date)::timestamp at time zone 'Europe/Bratislava'`,
    );
  }
  if (query.to) {
    const end = sql`(${query.to}::date + 1)::timestamp at time zone 'Europe/Bratislava'`;
    // A window is never longer than 14 days (`windowFor`), so the overlap also bounds
    // `window_end`: the backward index scan starts at the range instead of today.
    conditions.push(sql`s.window_start < ${end} and s.window_end < ${end} + interval '14 days'`);
  }
  if (query.q) {
    const pattern = `%${escapeLike(normalizeSearch(query.q))}%`;
    conditions.push(sql`${foldSql(sql`s.search_text`)} like ${pattern} escape '\\'`);
  }
  if (cursor) {
    conditions.push(sql`(s.window_end, s.id) < (${cursor.end}::timestamptz, ${cursor.id})`);
  }
  return sql`select s.id, s.group_id, g.name as group_name,
      (g.deactivated_at is not null) as group_deactivated, s.week, s.window_start,
      s.window_end, to_json(s.window_end) #>> '{}' as end_key, s.status, s.skip_reason,
      s.sent_at, s.sent_by, s.content
    from weekly_summaries s join groups g on g.id = s.group_id
    where ${sql.join(conditions, sql` and `)}
    order by s.window_end desc, s.id desc limit ${limit}`;
}

type ArchiveRow = {
  id: string;
  group_id: string;
  group_name: string;
  group_deactivated: boolean;
  week: string;
  window_start: string | Date;
  window_end: string | Date;
  end_key: string;
  status: SummaryRow['status'];
  skip_reason: SummaryRow['skipReason'];
  sent_at: string | Date | null;
  sent_by: string | null;
  content: WeeklySummaryContent | string;
};

const iso = (d: string | Date) => new Date(d).toISOString();

/** One page of the archive; the senders' names in one query for the page. */
export async function listArchive(
  db: Db,
  query: WeeklySummaryArchiveQuery,
): Promise<{ items: WeeklySummaryArchiveItem[]; nextCursor: string | null }> {
  const cursor = query.cursor ? decodeArchiveCursor(query.cursor) : null;
  const rows = [...(await db.execute<ArchiveRow>(listArchiveSql(query, cursor, query.limit + 1)))];
  const page = rows.slice(0, query.limit);
  const senders = await getNotificationProfiles(
    db,
    page.flatMap((r) => (r.sent_by ? [r.sent_by] : [])),
  );
  const last = page.at(-1);
  return {
    items: page.map((r) => {
      const sender = r.sent_by ? senders.get(r.sent_by) : undefined;
      return {
        id: r.id,
        groupId: r.group_id,
        groupName: r.group_name,
        groupDeactivated: r.group_deactivated,
        week: r.week,
        windowStart: iso(r.window_start),
        windowEnd: iso(r.window_end),
        status: r.status,
        skipReason: r.skip_reason,
        sentAt: r.sent_at === null ? null : iso(r.sent_at),
        sentBy: sender ? { name: sender.name } : null,
        content:
          typeof r.content === 'string'
            ? (JSON.parse(r.content) as WeeklySummaryContent)
            : r.content,
      };
    }),
    nextCursor:
      rows.length > query.limit && last
        ? encodeArchiveCursor({ end: last.end_key, id: last.id })
        : null,
  };
}
