import { sql, type SQL } from 'drizzle-orm';
import {
  WORKLOAD_LIMITS,
  type HomeWorkload,
  type SessionUser,
  type WorkloadAdmin,
  type WorkloadCounts,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { canSeeFinance } from '../finance/policy.js';
import { weekMinutesByUser } from '../finance/workload-time.js';
import { unseenTaskIdsSql, unseenTicketIdsSql } from '../notifications/unseen.js';
import { bratislavaToday } from './global-board.js';

/**
 * The admin dashboard's "Team workload" card (2026-10-19, see
 * docs/superpowers/specs/2026-10-19-admin-workload-design.md): per active admin
 * (`role in ('admin', 'superadmin')`, not disabled) the open tasks they are an assignee of, the
 * overdue ones (a due date before the Bratislava today), the active tickets (New, In progress)
 * they are a riešiteľ of, and the tasks and tickets with a change they have not seen (each
 * admin's own notification settings, as their header counts), by client. Deactivated groups
 * count nowhere; the admin group counts (marked internal); tickets without a client are the
 * "Bez klienta" row (`group_id` null).
 *
 * One statement (`workloadSql`), read-only: the documented read-only exception of `modules/home`
 * (docs/architecture/overview.md) for `user`, `groups`, `tasks`, `task_assignees`, `tickets` and
 * `ticket_assignees`; the unseen part is the notifications module's fragments, run per admin in
 * a lateral join. Indexes: `user_role_idx`, `task_assignees_user_id_idx`,
 * `ticket_assignees_user_idx`, the tasks, tickets and groups primary keys and
 * `notification_events_unseen_task_idx` / `_ticket_idx`. The finance minutes (finance holders
 * only) are the finance module's one grouped read (`weekMinutesByUser`, ADR 0027).
 */

/** Monday of the Bratislava week of `now`, and the next Monday (exclusive), `YYYY-MM-DD`. */
export function bratislavaWeek(now: Date): { from: string; until: string } {
  const today = new Date(`${bratislavaToday(now)}T00:00:00Z`);
  const from = new Date(today);
  from.setUTCDate(today.getUTCDate() - ((today.getUTCDay() + 6) % 7));
  const until = new Date(from);
  until.setUTCDate(from.getUTCDate() + 7);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  return { from: day(from), until: day(until) };
}

/**
 * The card's statement: one row per (admin, client with any count), ranked inside the admin by
 * load (tasks + tickets), overdue, the admin group first, name; admins without work get one row
 * with nulls. Every row carries its admin's totals (window sums), and the rows come ordered by
 * the admins' load, overdue, name. Each part of the `union all` fills its own column only, so
 * nothing counts twice.
 *
 * `only` (tests) restricts the statement to those user ids; the role and disabled rules still
 * apply.
 */
export function workloadSql(today: string, viewerId: string, only?: readonly string[]): SQL {
  const restrict =
    only === undefined
      ? sql``
      : only.length === 0
        ? sql` and false`
        : sql` and u.id in (${sql.join(
            only.map((id) => sql`${id}`),
            sql`, `,
          )})`;
  return sql`
    with wa as (
      select u.id, u.name from "user" u
      where u.role in ('admin', 'superadmin') and u.disabled_at is null${restrict}
    ),
    cells as (
      select c.user_id, c.group_id,
        sum(c.open_tasks)::int as open_tasks, sum(c.overdue_tasks)::int as overdue_tasks,
        sum(c.open_tickets)::int as open_tickets, sum(c.unseen)::int as unseen
      from (
        select ta.user_id, t.group_id, count(*) as open_tasks,
          count(*) filter (where t.due_date < ${today}::date) as overdue_tasks,
          0 as open_tickets, 0 as unseen
        from wa
        join task_assignees ta on ta.user_id = wa.id
        join tasks t on t.id = ta.task_id and t.completed_at is null
        join groups g on g.id = t.group_id and g.deactivated_at is null
        group by 1, 2
        union all
        select ka.user_id, k.group_id, 0, 0, count(*), 0
        from wa
        join ticket_assignees ka on ka.user_id = wa.id
        join tickets k on k.id = ka.ticket_id and k.status in ('new', 'in_progress')
        left join groups g on g.id = k.group_id
        where k.group_id is null or g.deactivated_at is null
        group by 1, 2
        union all
        select wa.id, t.group_id, 0, 0, 0, count(*)
        from wa
        cross join lateral (${unseenTaskIdsSql(sql`wa.id`)}) ux
        join tasks t on t.id = ux.task_id
        join groups g on g.id = t.group_id and g.deactivated_at is null
        group by 1, 2
        union all
        select wa.id, k.group_id, 0, 0, 0, count(*)
        from wa
        cross join lateral (${unseenTicketIdsSql(sql`wa.id`)}) ux
        join tickets k on k.id = ux.ticket_id
        left join groups g on g.id = k.group_id
        where k.group_id is null or g.deactivated_at is null
        group by 1, 2
      ) c
      group by 1, 2
    ),
    ranked as (
      select cells.*, g.name as group_name, coalesce(g.kind = 'admin', false) as internal,
        row_number() over (partition by cells.user_id
          order by cells.open_tasks + cells.open_tickets desc, cells.overdue_tasks desc,
            coalesce(g.kind = 'admin', false) desc, g.name nulls last, cells.group_id nulls last
        )::int as rn
      from cells left join groups g on g.id = cells.group_id
    )
    select * from (
      select wa.id as user_id, wa.name, wa.id = ${viewerId} as self,
        r.group_id, r.group_name, coalesce(r.internal, false) as internal, r.rn,
        coalesce(r.open_tasks, 0) as open_tasks, coalesce(r.overdue_tasks, 0) as overdue_tasks,
        coalesce(r.open_tickets, 0) as open_tickets, coalesce(r.unseen, 0) as unseen,
        coalesce(sum(r.open_tasks) over w, 0)::int as total_tasks,
        coalesce(sum(r.overdue_tasks) over w, 0)::int as total_overdue,
        coalesce(sum(r.open_tickets) over w, 0)::int as total_tickets,
        coalesce(sum(r.unseen) over w, 0)::int as total_unseen
      from wa
      left join ranked r on r.user_id = wa.id
      window w as (partition by wa.id)
    ) rows
    order by total_tasks + total_tickets desc, total_overdue desc, name, user_id, rn
  `;
}

type Row = {
  user_id: string;
  name: string;
  self: boolean;
  group_id: string | null;
  group_name: string | null;
  internal: boolean;
  /** Null for an admin without work (their one row). */
  rn: number | null;
  open_tasks: number;
  overdue_tasks: number;
  open_tickets: number;
  unseen: number;
  total_tasks: number;
  total_overdue: number;
  total_tickets: number;
  total_unseen: number;
};

const countsOf = (r: Row): WorkloadCounts => ({
  openTasks: r.open_tasks,
  overdueTasks: r.overdue_tasks,
  openTickets: r.open_tickets,
  unseen: r.unseen,
});

/**
 * The card's answer: the statement's rows folded in one pass (the order is the statement's),
 * the first `WORKLOAD_LIMITS.clientsPerAdmin` clients of an admin listed and the rest summed,
 * at most `WORKLOAD_LIMITS.admins` admins. For a finance holder (`canSeeFinance`) one more read,
 * the week's filled minutes; for anyone else `week` is null and no row has `minutesThisWeek`.
 *
 * `deps.admins` (tests) restricts the admins; `deps.weekMinutes` replaces the finance read.
 */
export async function getWorkload(
  db: Db,
  viewer: SessionUser,
  now: Date,
  deps: { weekMinutes?: typeof weekMinutesByUser; admins?: readonly string[] } = {},
): Promise<HomeWorkload> {
  const today = bratislavaToday(now);
  const rows = [...(await db.execute<Row>(workloadSql(today, viewer.id, deps.admins)))];
  const admins: WorkloadAdmin[] = [];
  let current: WorkloadAdmin | undefined;
  for (const r of rows) {
    if (current?.userId !== r.user_id) {
      if (admins.length === WORKLOAD_LIMITS.admins) break;
      current = {
        userId: r.user_id,
        name: r.name,
        self: r.self,
        openTasks: r.total_tasks,
        overdueTasks: r.total_overdue,
        openTickets: r.total_tickets,
        unseen: r.total_unseen,
        clients: [],
        moreClients: null,
      };
      admins.push(current);
    }
    if (r.rn === null) continue;
    if (r.rn <= WORKLOAD_LIMITS.clientsPerAdmin) {
      current.clients.push({
        ...countsOf(r),
        groupId: r.group_id,
        name: r.group_name,
        internal: r.internal,
      });
    } else {
      const more = current.moreClients ?? {
        count: 0,
        openTasks: 0,
        overdueTasks: 0,
        openTickets: 0,
        unseen: 0,
      };
      current.moreClients = {
        count: more.count + 1,
        openTasks: more.openTasks + r.open_tasks,
        overdueTasks: more.overdueTasks + r.overdue_tasks,
        openTickets: more.openTickets + r.open_tickets,
        unseen: more.unseen + r.unseen,
      };
    }
  }

  if (!canSeeFinance(viewer)) return { today, week: null, admins };
  const week = bratislavaWeek(now);
  const minutes = await (deps.weekMinutes ?? weekMinutesByUser)(
    db,
    admins.map((a) => a.userId),
    week,
  );
  return {
    today,
    week,
    admins: admins.map((a) => ({ ...a, minutesThisWeek: minutes.get(a.userId) ?? 0 })),
  };
}
