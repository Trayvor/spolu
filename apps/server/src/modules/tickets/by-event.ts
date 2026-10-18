import { sql, type SQL } from 'drizzle-orm';
import type { TicketStatus } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { doneBefore, type DoneCursor } from '../tasks/by-event.js';

/**
 * The tickets under the timeline's events (Phase 33 part P4, spec §3.1, §7.3), for the projects
 * module, which never reads `tickets` itself. Every read goes through `tickets_event_project_idx`
 * (`event_id`) and the client's `group_id`. Open (New, In progress) tickets newest first; resolved
 * ones by when they were resolved, newest first.
 */

export type EventTicketRow = {
  id: string;
  eventId: string;
  number: number;
  subject: string | null;
  status: TicketStatus;
  /** ISO, microseconds: the open list's keyset. */
  createdAt: string;
  /** ISO, microseconds, resolved tickets only: the done pile's keyset. */
  doneAt: string | null;
};

/** Where an open list continues: the last row's (created at, id), newest first. */
export type OpenTicketCursor = { createdAt: string; id: string };

type Row = {
  id: string;
  event_id: string;
  number: number;
  subject: string | null;
  status: TicketStatus;
  created_at: string;
  done_at: string | null;
};

const ISO = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
/** When a ticket was resolved; tickets resolved before `resolved_at` existed use their update. */
const DONE_AT = sql`coalesce(k.resolved_at, k.updated_at)`;
const columns = sql`k.id, k.event_id, k.number, k.subject, k.status,
  to_char(k.created_at at time zone 'UTC', ${ISO}) as created_at,
  case when k.status = 'resolved' then to_char(${DONE_AT} at time zone 'UTC', ${ISO}) end as done_at`;

const toRow = (r: Row): EventTicketRow => ({
  id: r.id,
  eventId: r.event_id,
  number: r.number,
  subject: r.subject,
  status: r.status,
  createdAt: r.created_at,
  doneAt: r.done_at,
});

/** The statement of the events' rows and counts, exported for the EXPLAIN check. */
export function ticketsByEventsSql(groupId: string, eventIds: string[], openLimit: number): SQL {
  return sql`
    select x.* from (
      select ${columns}, k.status = 'resolved' as done,
        (row_number() over (partition by k.event_id, k.status = 'resolved'
          order by k.created_at desc, k.id desc))::int as rn,
        (count(*) over (partition by k.event_id, k.status = 'resolved'))::int as n
      from tickets k
      where k.event_id = any(${sql`array[${sql.join(eventIds, sql`, `)}]::text[]`})
        and k.group_id = ${groupId}
    ) x
    where (not x.done and x.rn <= ${openLimit}) or (x.done and x.rn = 1)
    order by x.event_id, x.done, x.rn`;
}

/**
 * Up to `openLimit` open tickets of each event and each event's open and resolved counts, in one
 * query (a window over the events' tickets). Events without tickets are left out of the map.
 */
export async function ticketsByEvents(
  db: Db,
  groupId: string,
  eventIds: string[],
  opts: { openLimit: number },
): Promise<Map<string, { open: EventTicketRow[]; openCount: number; doneCount: number }>> {
  const result = new Map<
    string,
    { open: EventTicketRow[]; openCount: number; doneCount: number }
  >();
  if (eventIds.length === 0) return result;
  const rows = await db.execute<Row & { done: boolean; n: number; rn: number }>(
    ticketsByEventsSql(groupId, eventIds, opts.openLimit),
  );
  for (const row of rows) {
    let entry = result.get(row.event_id);
    if (!entry) {
      entry = { open: [], openCount: 0, doneCount: 0 };
      result.set(row.event_id, entry);
    }
    if (row.done) entry.doneCount = row.n;
    else {
      entry.openCount = row.n;
      entry.open.push(toRow(row));
    }
  }
  return result;
}

/** One page of an event's open tickets (the event sheet), newest first, after `after`. */
export async function openTicketsOfEvent(
  db: Db,
  groupId: string,
  eventId: string,
  opts: { after?: OpenTicketCursor; limit: number },
): Promise<EventTicketRow[]> {
  const after = opts.after
    ? sql`and (k.created_at, k.id) < (${opts.after.createdAt}::timestamptz, ${opts.after.id})`
    : sql``;
  const rows = await db.execute<Row>(sql`
    select ${columns} from tickets k
    where k.event_id = ${eventId} and k.group_id = ${groupId} and k.status <> 'resolved' ${after}
    order by k.created_at desc, k.id desc
    limit ${opts.limit}`);
  return [...rows].map(toRow);
}

/** One page of an event's resolved tickets (the done pile), newest first, before `before`. */
export async function resolvedTicketsOfEvent(
  db: Db,
  groupId: string,
  eventId: string,
  opts: { before?: DoneCursor; limit: number },
): Promise<EventTicketRow[]> {
  const before = doneBefore(DONE_AT, sql`k.id`, opts.before);
  const rows = await db.execute<Row>(sql`
    select ${columns} from tickets k
    where k.event_id = ${eventId} and k.group_id = ${groupId} and k.status = 'resolved' ${before}
    order by ${DONE_AT} desc, k.id desc
    limit ${opts.limit}`);
  return [...rows].map(toRow);
}
