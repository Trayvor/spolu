import { sql, type SQL } from 'drizzle-orm';
import { HOME_LIMITS, type HomeTickets, type TicketStatus } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { managedGroupsSql } from '../groups/managers.js';

// The admin dashboard's tickets (the Tickets card and the header's Tickets count): the active
// tickets (New, In progress) that are the viewer's to answer, that is of the clients they manage,
// and those without a client, which nobody looks after yet. Admins only: the caller checks it.
// Two branches joined with `union all`, so each reads its own index
// (`tickets_group_status_created_idx` for the managed clients, `tickets_unassigned_created_idx`
// for no client) instead of one `or` that would scan the table.

const ACTIVE = sql`('new', 'in_progress')`;
const EXCERPT = 80;

function activeTicketsSql(userId: string): SQL {
  return sql`
    select id, number, subject, body, status, group_id, due_date, created_at
    from tickets
    where group_id in ${managedGroupsSql(userId)} and status in ${ACTIVE}
    union all
    select id, number, subject, body, status, group_id, due_date, created_at
    from tickets
    where group_id is null and status in ${ACTIVE}
  `;
}

/** New first, then newest first; the window counts give the totals before the limit. */
export function dashboardTicketsSql(userId: string): SQL {
  return sql`
    select
      t.id,
      t.number,
      t.subject,
      left(t.body, ${EXCERPT}) as excerpt,
      t.status,
      t.group_id,
      g.name as group_name,
      t.due_date,
      t.created_at,
      (count(*) over ())::int as total,
      (count(*) filter (where t.status = 'new') over ())::int as fresh_total,
      (count(*) filter (where t.group_id is null) over ())::int as unassigned_total
    from (${activeTicketsSql(userId)}) t
    left join groups g on g.id = t.group_id
    order by (t.status = 'new') desc, t.created_at desc, t.id desc
    limit ${HOME_LIMITS.tickets}
  `;
}

type Row = {
  id: string;
  number: number;
  subject: string | null;
  excerpt: string | null;
  status: TicketStatus;
  group_id: string | null;
  group_name: string | null;
  due_date: string | null;
  created_at: Date | string;
  total: number;
  fresh_total: number;
  unassigned_total: number;
};

export async function getDashboardTickets(db: Db, userId: string): Promise<HomeTickets> {
  const rows = [...(await db.execute<Row>(dashboardTicketsSql(userId)))];
  const first = rows[0];
  return {
    total: first?.total ?? 0,
    fresh: first?.fresh_total ?? 0,
    unassigned: first?.unassigned_total ?? 0,
    items: rows.map((r) => ({
      id: r.id,
      number: r.number,
      subject: r.subject,
      excerpt: r.excerpt,
      status: r.status,
      groupId: r.group_id,
      groupName: r.group_name,
      dueDate: r.due_date,
      createdAt: new Date(r.created_at).toISOString(),
    })),
  };
}

/** The header's count, in its two parts: one statement, two index reads. */
export function dashboardTicketCountsSql(userId: string): SQL {
  return sql`
    select
      (select count(*) from tickets
        where group_id in ${managedGroupsSql(userId)} and status in ${ACTIVE})::int as mine,
      (select count(*) from tickets
        where group_id is null and status in ${ACTIVE})::int as unassigned
  `;
}

export async function countDashboardTickets(
  db: Db,
  userId: string,
): Promise<{ mine: number; unassigned: number }> {
  const [row] = [
    ...(await db.execute<{ mine: number; unassigned: number }>(dashboardTicketCountsSql(userId))),
  ];
  return { mine: row?.mine ?? 0, unassigned: row?.unassigned ?? 0 };
}
