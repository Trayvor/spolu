import { sql, type SQL } from 'drizzle-orm';
import type { SidebarClient } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { unreadByGroupSql } from '../chat/service.js';
import { managedGroupsSql } from '../groups/managers.js';
import { groupChatNotifiesSql } from '../notifications/follows.js';
import { unseenTaskIdsSql, unseenTicketIdsSql } from '../notifications/unseen.js';

/**
 * The admin sidebar in one statement: every group with the viewer's unread group chat count
 * (the Chat tab number), the tasks and the tickets of it with a change the viewer has not seen
 * (2026-10-17, `unseen.ts`; the row's one black badge adds the three), and whether they manage
 * it. Ordered managed first; inside each section those with a badge, then the rest, by name (a
 * stable order, so rows do not jump while the admin reads).
 *
 * The unread number is 0 for a group whose chat never notifies the viewer (2026-10-17, the
 * dashboard follows the notification settings): their mode for it is Off, or their chat channel
 * is None (`groupChatNotifiesSql`, the notifications module's mirror of delivery). Mentions and
 * replies keeps the full count. The order uses the shown numbers.
 *
 * Reads the chat, tasks, tickets and groups tables directly: the documented read-only exception
 * of `modules/home` (see docs/architecture/overview.md).
 */
export function sidebarSql(userId: string): SQL {
  return sql`
    select * from (
      select
        g.id as group_id,
        g.name,
        g.logo_key is not null as has_logo,
        g.updated_at,
        g.id in ${managedGroupsSql(userId)} as managed,
        (case when ${groupChatNotifiesSql(userId, sql`g.id`)} then coalesce(u.n, 0) else 0 end)::int
          as unread,
        coalesce(ut.n, 0)::int as unseen_tasks,
        coalesce(uk.n, 0)::int as unseen_tickets
      from groups g
      left join (${unreadByGroupSql(userId)}) u on u.group_id = g.id
      left join (
        select t.group_id, count(*) as n
        from (${unseenTaskIdsSql(userId)}) x
        join tasks t on t.id = x.task_id
        group by t.group_id
      ) ut on ut.group_id = g.id
      left join (
        select k.group_id, count(*) as n
        from (${unseenTicketIdsSql(userId)}) x
        join tickets k on k.id = x.ticket_id
        where k.group_id is not null
        group by k.group_id
      ) uk on uk.group_id = g.id
    ) s
    order by managed desc, (unread + unseen_tasks + unseen_tickets > 0) desc, name, group_id
  `;
}

type Row = {
  group_id: string;
  name: string;
  has_logo: boolean;
  updated_at: string | Date;
  managed: boolean;
  unread: number;
  unseen_tasks: number;
  unseen_tickets: number;
};

export async function getSidebar(db: Db, userId: string): Promise<SidebarClient[]> {
  const rows = await db.execute<Row>(sidebarSql(userId));
  return [...rows].map((r) => ({
    groupId: r.group_id,
    name: r.name,
    hasLogo: r.has_logo,
    updatedAt: new Date(r.updated_at).toISOString(),
    managed: r.managed,
    unread: r.unread,
    unseenTasks: r.unseen_tasks,
    unseenTickets: r.unseen_tickets,
  }));
}
