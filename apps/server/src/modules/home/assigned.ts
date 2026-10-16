import { sql, type SQL } from 'drizzle-orm';
import { HOME_LIMITS, type AssignedTasks, type BucketKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * The viewer's open assigned tasks across groups, in one statement: urgent first (by deadline, no
 * deadline last among them), then by deadline ascending (overdue first, their dates are the
 * earliest), then no deadline, oldest first. The window counts give the totals before the limit.
 */
export function assignedSql(userId: string): SQL {
  return sql`
    select
      t.id,
      t.group_id,
      g.name as group_name,
      t.title,
      t.urgent,
      t.due_date,
      b.kind as bucket_kind,
      (count(*) over ())::int as total,
      (count(*) filter (where t.urgent) over ())::int as urgent_total
    from task_assignees ta
    join tasks t on t.id = ta.task_id
    join groups g on g.id = t.group_id
    join buckets b on b.id = t.bucket_id
    where ta.user_id = ${userId}
      and t.completed_at is null
    order by t.urgent desc, t.due_date asc nulls last, t.created_at asc, t.id
    limit ${HOME_LIMITS.tasks}
  `;
}

type Row = {
  id: string;
  group_id: string;
  group_name: string;
  title: string;
  urgent: boolean;
  due_date: string | null;
  bucket_kind: BucketKind;
  total: number;
  urgent_total: number;
};

export async function getAssignedTasks(db: Db, userId: string): Promise<AssignedTasks> {
  const rows = [...(await db.execute<Row>(assignedSql(userId)))];
  const first = rows[0];
  return {
    total: first?.total ?? 0,
    urgent: first?.urgent_total ?? 0,
    items: rows.map((r) => ({
      id: r.id,
      groupId: r.group_id,
      groupName: r.group_name,
      title: r.title,
      urgent: r.urgent,
      dueDate: r.due_date,
      bucketKind: r.bucket_kind,
    })),
  };
}

/**
 * The header's Tasks count: the viewer's open tasks (not in Completed), the same set as the
 * "My tasks" card's total. Unassigned tasks do not count. Reads `task_assignees_user_id_idx`.
 */
export function assignedCountSql(userId: string): SQL {
  return sql`
    select count(*)::int as total
    from task_assignees ta
    join tasks t on t.id = ta.task_id
    where ta.user_id = ${userId}
      and t.completed_at is null
  `;
}

export async function countAssignedTasks(db: Db, userId: string): Promise<number> {
  const [row] = [...(await db.execute<{ total: number }>(assignedCountSql(userId)))];
  return row?.total ?? 0;
}
