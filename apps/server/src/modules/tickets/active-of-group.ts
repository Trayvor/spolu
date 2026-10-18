import { sql, type SQL } from 'drizzle-orm';
import type { TicketStatus } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * The overview's Tickets card (Phase 33 part P4, spec §7.4, decision 18): the client's New and In
 * progress tickets, those the user is a riešiteľ of first, then newest first; with the totals.
 * One query on `tickets_group_status_created_idx`; the window counts give the totals before the
 * limit.
 */

export type ActiveTicketRowData = {
  id: string;
  number: number;
  subject: string | null;
  status: TicketStatus;
  createdAt: string;
  mine: boolean;
  projectId: string | null;
  eventId: string | null;
};

type Row = {
  id: string;
  number: number;
  subject: string | null;
  status: TicketStatus;
  created_at: string;
  mine: boolean;
  project_id: string | null;
  event_id: string | null;
  total: number;
  mine_total: number;
};

/** The card's statement, exported for the EXPLAIN check. */
export function activeTicketsOfSql(groupId: string, userId: string, limit: number): SQL {
  return sql`
    select x.id, x.number, x.subject, x.status, x.project_id, x.event_id, x.mine,
      to_char(x.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as created_at,
      (count(*) over ())::int as total,
      (count(*) filter (where x.mine) over ())::int as mine_total
    from (
      select k.id, k.number, k.subject, k.status, k.created_at, k.project_id, k.event_id,
        exists (select 1 from ticket_assignees a
          where a.ticket_id = k.id and a.user_id = ${userId}) as mine
      from tickets k
      where k.group_id = ${groupId} and k.status in ('new', 'in_progress')
    ) x
    order by x.mine desc, x.created_at desc, x.id desc
    limit ${limit}`;
}

export async function activeTicketsOf(
  db: Db,
  groupId: string,
  userId: string,
  limit: number,
): Promise<{ rows: ActiveTicketRowData[]; total: number; mine: number }> {
  const rows = [...(await db.execute<Row>(activeTicketsOfSql(groupId, userId, limit)))];
  const first = rows[0];
  return {
    total: first?.total ?? 0,
    mine: first?.mine_total ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      subject: r.subject,
      status: r.status,
      createdAt: r.created_at,
      mine: r.mine,
      projectId: r.project_id,
      eventId: r.event_id,
    })),
  };
}
