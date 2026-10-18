import { desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  TICKET_RATING_LIMITS,
  type TicketRatingDays,
  type TicketRatingList,
  type TicketRatingQuery,
  type TicketRatingSummary,
  type TicketRatingValue,
  type TicketRatingWithRater,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { getUserNames } from '../users/service.js';
import { ticketRatings } from './schema.js';

/**
 * Ticket ratings (2026-10-19): the initiator's 👍/👎 with an optional comment. Only this module
 * reads `ticket_ratings`; the routes check who may write (`canRateTicket`, `ratingOpen`) and
 * who may read (`canSeeTicketRatings`). Never log a comment.
 */

export type RatingWrite = { value: TicketRatingValue; comment?: string | null };

/**
 * Upserts the person's rating in one statement. `comment` absent keeps the stored one, null
 * clears it. `turnedDown`: this write made the rating 👎 for the first time, so the 👎
 * notification is due; `down_notified_at` is set by the same statement, so two concurrent writes
 * never both answer true.
 */
export async function setTicketRating(
  db: Db,
  ticketId: string,
  userId: string,
  body: RatingWrite,
  now: Date,
): Promise<{ turnedDown: boolean }> {
  const at = now.toISOString();
  const keepComment = body.comment === undefined;
  const rows = await db.execute<{ turned_down: boolean }>(sql`
    insert into ticket_ratings as r
      (ticket_id, user_id, value, comment, created_at, updated_at, down_notified_at)
    values (
      ${ticketId}, ${userId}, ${body.value}, ${body.comment ?? null},
      ${at}::timestamptz, ${at}::timestamptz,
      case when ${body.value} = 'down' then ${at}::timestamptz end
    )
    on conflict (ticket_id, user_id) do update set
      value = excluded.value,
      comment = case when ${keepComment} then r.comment else excluded.comment end,
      updated_at = excluded.updated_at,
      down_notified_at = coalesce(
        r.down_notified_at,
        case when excluded.value = 'down' then excluded.updated_at end
      )
    returning coalesce(r.down_notified_at = ${at}::timestamptz, false) as turned_down`);
  return { turnedDown: [...rows][0]?.turned_down === true };
}

/**
 * Every rating of the ticket, newest first, with the rater's name: one query on the primary
 * key's prefix, and the names in one more when there is any rating and `withNames` (admins; the
 * rater's own copy needs none).
 */
export async function ratingsOfTicket(
  db: Db,
  ticketId: string,
  withNames = true,
): Promise<TicketRatingWithRater[]> {
  const rows = await db
    .select({
      userId: ticketRatings.userId,
      value: ticketRatings.value,
      comment: ticketRatings.comment,
      updatedAt: ticketRatings.updatedAt,
    })
    .from(ticketRatings)
    .where(eq(ticketRatings.ticketId, ticketId))
    .orderBy(desc(ticketRatings.updatedAt), desc(ticketRatings.userId));
  if (rows.length === 0) return [];
  const names = withNames
    ? await getUserNames(
        db,
        rows.map((r) => r.userId),
      )
    : new Map<string, string>();
  return rows.map((r) => ({
    userId: r.userId,
    name: names.get(r.userId) ?? null,
    value: r.value,
    comment: r.comment,
    ratedAt: r.updatedAt.toISOString(),
  }));
}

const DAY_MS = 86_400_000;
const sinceOf = (days: TicketRatingDays, now: Date) => new Date(now.getTime() - days * DAY_MS);

/**
 * The summary's two statements, exported for the EXPLAIN checks: (1) the ratings changed since
 * `since`, a range on `ticket_ratings_updated_idx` (the client through the tickets primary key);
 * (2) the tickets resolved since `since` with an initiator account, on `tickets_resolved_at_idx`,
 * and how many of them have a rating (the `ticket_ratings` primary key).
 */
export function ratingSummarySql(q: { since: Date; groupId?: string }): {
  ratings: SQL;
  resolved: SQL;
} {
  const since = q.since.toISOString();
  const ratings = sql`
    select count(*) filter (where r.value = 'up')::int as up,
           count(*) filter (where r.value = 'down')::int as down
    from ticket_ratings r
    ${q.groupId === undefined ? sql`` : sql`join tickets t on t.id = r.ticket_id and t.group_id = ${q.groupId}`}
    where r.updated_at >= ${since}::timestamptz`;
  const resolved = sql`
    select count(*)::int as resolved,
           count(*) filter (
             where exists (select 1 from ticket_ratings x where x.ticket_id = t.id)
           )::int as rated
    from tickets t
    where t.status = 'resolved' and t.resolved_at >= ${since}::timestamptz
      and t.requester_user_id is not null
      ${q.groupId === undefined ? sql`` : sql`and t.group_id = ${q.groupId}`}`;
  return { ratings, resolved };
}

/** The totals of the last `days` days, of one client or of every client. */
export async function getRatingSummary(
  db: Db,
  q: { days: TicketRatingDays; groupId?: string },
  now: Date,
): Promise<TicketRatingSummary> {
  const { ratings, resolved } = ratingSummarySql({
    since: sinceOf(q.days, now),
    groupId: q.groupId,
  });
  const [r, t] = await Promise.all([
    db.execute<{ up: number; down: number }>(ratings),
    db.execute<{ resolved: number; rated: number }>(resolved),
  ]);
  const a = [...r][0];
  const b = [...t][0];
  return {
    days: q.days,
    up: a?.up ?? 0,
    down: a?.down ?? 0,
    resolved: b?.resolved ?? 0,
    rated: b?.rated ?? 0,
  };
}

export class InvalidRatingCursorError extends Error {
  constructor() {
    super('Invalid rating list cursor');
    this.name = 'InvalidRatingCursorError';
  }
}

/** The keyset of the list: `updated_at` as PostgreSQL wrote it (microseconds), ticket, rater. */
export type RatingCursor = { at: string; ticketId: string; userId: string };

const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

const encodeRatingCursor = (c: RatingCursor) =>
  Buffer.from(`${c.at}|${c.ticketId}|${c.userId}`).toString('base64url');

function decodeRatingCursor(cursor: string): RatingCursor {
  const [at, ticketId, userId] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (!at || !AT.test(at) || !ticketId || !userId) throw new InvalidRatingCursorError();
  return { at, ticketId, userId };
}

/**
 * One page of ratings changed since `since`, newest first, keyset on (`updated_at`, ticket,
 * rater) along `ticket_ratings_updated_idx`, with the ticket and its client by primary key.
 * Exported for the EXPLAIN checks.
 */
export function ratingListSql(q: {
  since: Date;
  groupId?: string;
  value?: TicketRatingValue;
  after?: RatingCursor;
}): SQL {
  const where: SQL[] = [sql`r.updated_at >= ${q.since.toISOString()}::timestamptz`];
  if (q.groupId !== undefined) where.push(sql`t.group_id = ${q.groupId}`);
  if (q.value !== undefined) where.push(sql`r.value = ${q.value}`);
  if (q.after) {
    where.push(
      sql`(r.updated_at, r.ticket_id, r.user_id) < (${q.after.at}::timestamptz, ${q.after.ticketId}, ${q.after.userId})`,
    );
  }
  // Deliberate read-only exception, as in the ticket list: the client's name in the one query.
  return sql`
    select r.ticket_id, t.number, t.subject, t.group_id, g.name as group_name, r.user_id,
           r.value, r.comment,
           to_char(r.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
    from ticket_ratings r
    join tickets t on t.id = r.ticket_id
    left join groups g on g.id = t.group_id
    where ${sql.join(where, sql` and `)}
    order by r.updated_at desc, r.ticket_id desc, r.user_id desc
    limit ${TICKET_RATING_LIMITS.pageSize + 1}`;
}

type ListRow = {
  ticket_id: string;
  number: number;
  subject: string | null;
  group_id: string | null;
  group_name: string | null;
  user_id: string;
  value: TicketRatingValue;
  comment: string | null;
  at: string;
};

/** A page of the ratings view (admins): the list query and the raters' names, two queries. */
export async function listRatings(
  db: Db,
  q: Pick<TicketRatingQuery, 'days' | 'groupId' | 'value' | 'cursor'>,
  now: Date,
): Promise<TicketRatingList> {
  const after = q.cursor ? decodeRatingCursor(q.cursor) : undefined;
  const rows = [
    ...(await db.execute<ListRow>(
      ratingListSql({ since: sinceOf(q.days, now), groupId: q.groupId, value: q.value, after }),
    )),
  ];
  const limit = TICKET_RATING_LIMITS.pageSize;
  const page = rows.slice(0, limit);
  const names = await getUserNames(
    db,
    page.map((r) => r.user_id),
  );
  const last = page[page.length - 1];
  return {
    items: page.map((r) => ({
      ticketId: r.ticket_id,
      number: Number(r.number),
      subject: r.subject,
      groupId: r.group_id,
      groupName: r.group_name,
      raterId: r.user_id,
      raterName: names.get(r.user_id) ?? null,
      value: r.value,
      comment: r.comment,
      ratedAt: new Date(r.at).toISOString(),
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeRatingCursor({ at: last.at, ticketId: last.ticket_id, userId: last.user_id })
        : null,
  };
}
