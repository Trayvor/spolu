import { sql, type SQL } from 'drizzle-orm';
import { HOME_LIMITS, type HomeTickets, type TicketStatus } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { watchedGroupsSql } from './watch.js';

// The admin dashboard's tickets (the Tickets card and the header's Tickets count): the active
// tickets (New, In progress) that are the viewer's to answer, the same people their updates
// notify (`audience.ts`): those they are a riešiteľ of, those without a riešiteľ of the clients
// whose tickets they watch (`watch.ts`: by default the clients they manage), and those without a
// client and without a riešiteľ, which every admin hears about. Admins only: the caller
// checks it. Three disjoint branches joined with `union all`, so each reads its own index
// (`ticket_assignees_user_idx`, `tickets_group_status_created_idx`,
// `tickets_unassigned_created_idx`) instead of one `or` that would scan the table.

const ACTIVE = sql`('new', 'in_progress')`;
const EXCERPT = 80;
const COLUMNS = sql`t.id, t.number, t.subject, t.body, t.status, t.group_id, t.due_date, t.created_at`;

function activeTicketsSql(userId: string): SQL {
  return sql`
    select ${COLUMNS}, true as has_assignee
    from ticket_assignees a
    inner join tickets t on t.id = a.ticket_id
    where a.user_id = ${userId} and t.status in ${ACTIVE}
    union all
    select ${COLUMNS}, false as has_assignee
    from tickets t
    where t.group_id in ${watchedGroupsSql(userId)} and t.status in ${ACTIVE}
      and not exists (select 1 from ticket_assignees x where x.ticket_id = t.id)
    union all
    select ${COLUMNS}, false as has_assignee
    from tickets t
    where t.group_id is null and t.status in ${ACTIVE}
      and not exists (select 1 from ticket_assignees x where x.ticket_id = t.id)
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
      t.has_assignee,
      (count(*) over ())::int as total,
      (count(*) filter (where t.status = 'new') over ())::int as fresh_total,
      (count(*) filter (where not t.has_assignee) over ())::int as no_assignee_total
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
  has_assignee: boolean;
  total: number;
  fresh_total: number;
  no_assignee_total: number;
};

export async function getDashboardTickets(db: Db, userId: string): Promise<HomeTickets> {
  const rows = [...(await db.execute<Row>(dashboardTicketsSql(userId)))];
  const first = rows[0];
  return {
    total: first?.total ?? 0,
    fresh: first?.fresh_total ?? 0,
    noAssignee: first?.no_assignee_total ?? 0,
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
      hasAssignee: r.has_assignee,
    })),
  };
}

/** The header's count: the Tickets card's total, in one statement. */
export function dashboardTicketCountSql(userId: string): SQL {
  return sql`select count(*)::int as total from (${activeTicketsSql(userId)}) t`;
}

export async function countDashboardTickets(db: Db, userId: string): Promise<number> {
  const [row] = [...(await db.execute<{ total: number }>(dashboardTicketCountSql(userId)))];
  return row?.total ?? 0;
}
