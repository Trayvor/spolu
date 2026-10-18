import { sql, type SQL } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';

/**
 * The overview's Tasks card (Phase 33 part P4, spec §7.4, decision 18): the client's tasks not in
 * Completed, the user's own first (they are an assignee), then urgent, then by deadline (none
 * last), then oldest first; with the totals. One query on `tasks_open_group_idx`; the window
 * counts give the totals before the limit, and the assignee ids are read for the page only.
 */

export type OpenTaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  urgent: boolean;
  mine: boolean;
  projectId: string | null;
  eventId: string | null;
  assigneeIds: string[];
};

type Row = {
  id: string;
  title: string;
  due_date: string | null;
  urgent: boolean;
  mine: boolean;
  project_id: string | null;
  event_id: string | null;
  assignee_ids: string[];
  total: number;
  mine_total: number;
  urgent_total: number;
};

/** The card's statement, exported for the EXPLAIN check. */
export function openTasksOfSql(groupId: string, userId: string, limit: number): SQL {
  const order = (a: string) =>
    sql.raw(
      `${a}.mine desc, ${a}.urgent desc, ${a}.due_date asc nulls last, ${a}.created_at, ${a}.id`,
    );
  return sql`
    select p.*, array(select a.user_id from task_assignees a where a.task_id = p.id
      order by a.user_id) as assignee_ids
    from (
      select x.*,
        (count(*) over ())::int as total,
        (count(*) filter (where x.mine) over ())::int as mine_total,
        (count(*) filter (where x.urgent) over ())::int as urgent_total
      from (
        select t.id, t.title, t.due_date::text as due_date, t.urgent, t.created_at,
          t.project_id, t.event_id,
          exists (select 1 from task_assignees a
            where a.task_id = t.id and a.user_id = ${userId}) as mine
        from tasks t
        where t.group_id = ${groupId} and t.completed_at is null
      ) x
      order by ${order('x')}
      limit ${limit}
    ) p
    order by ${order('p')}`;
}

export async function openTasksOf(
  db: Db,
  groupId: string,
  userId: string,
  limit: number,
): Promise<{ rows: OpenTaskRow[]; total: number; mine: number; urgent: number }> {
  const rows = [...(await db.execute<Row>(openTasksOfSql(groupId, userId, limit)))];
  const first = rows[0];
  return {
    total: first?.total ?? 0,
    mine: first?.mine_total ?? 0,
    urgent: first?.urgent_total ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      title: r.title,
      dueDate: r.due_date,
      urgent: r.urgent,
      mine: r.mine,
      projectId: r.project_id,
      eventId: r.event_id,
      assigneeIds: r.assignee_ids,
    })),
  };
}
