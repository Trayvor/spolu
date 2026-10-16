import { sql, type SQL } from 'drizzle-orm';
import type { SidebarClient } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { unreadByGroupSql } from '../chat/service.js';
import { managedGroupsSql } from '../groups/managers.js';

/**
 * The admin sidebar in one statement: every group with the viewer's unread group chat count
 * (the Chat tab number), their open assigned tasks there, and whether they manage it. Ordered
 * managed first; inside each section unread, then assigned, then the rest, by name (a stable
 * order, so rows do not jump while the admin reads).
 *
 * Reads the chat, tasks and groups tables directly: the documented read-only exception of
 * `modules/home` (see docs/architecture/overview.md).
 */
export function sidebarSql(userId: string): SQL {
  return sql`
    select
      g.id as group_id,
      g.name,
      g.logo_key is not null as has_logo,
      g.updated_at,
      g.id in ${managedGroupsSql(userId)} as managed,
      coalesce(u.n, 0)::int as unread,
      coalesce(a.n, 0)::int as assigned
    from groups g
    left join (${unreadByGroupSql(userId)}) u on u.group_id = g.id
    left join (
      select t.group_id, count(*) as n
      from task_assignees ta
      join tasks t on t.id = ta.task_id
      where ta.user_id = ${userId}
        and t.completed_at is null
      group by t.group_id
    ) a on a.group_id = g.id
    order by managed desc, (coalesce(u.n, 0) > 0) desc, (coalesce(a.n, 0) > 0) desc, g.name, g.id
  `;
}

type Row = {
  group_id: string;
  name: string;
  has_logo: boolean;
  updated_at: string | Date;
  managed: boolean;
  unread: number;
  assigned: number;
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
    assigned: r.assigned,
  }));
}
