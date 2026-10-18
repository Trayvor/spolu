import { inArray, sql, type SQL } from 'drizzle-orm';
import {
  HOME_LIMITS,
  type AssignedTasks,
  type BucketKind,
  type TimeRequest,
  type UnseenMark,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { myTimeRequests } from '../finance/task-time.js';
import { liveGroupSql } from '../groups/memberships.js';
import { groups } from '../groups/schema.js';
import { taskUnseenSql, unseenTaskIdsSql } from '../notifications/unseen.js';
import { getTaskTitles } from '../tasks/task-service.js';

/**
 * The viewer's open assigned tasks across groups, in one statement: urgent first (by deadline, no
 * deadline last among them), then by deadline ascending (overdue first, their dates are the
 * earliest), then no deadline, oldest first. The window counts give the totals before the limit.
 * `unseen` (2026-10-17) is computed for the page only, after the limit.
 */
export function assignedSql(userId: string): SQL {
  return sql`
    select p.*, ${taskUnseenSql(userId, sql`p.id`)} as unseen
    from (
      select
        t.id,
        t.group_id,
        g.name as group_name,
        t.title,
        t.urgent,
        t.due_date,
        t.created_at,
        b.kind as bucket_kind,
        (count(*) over ())::int as total,
        (count(*) filter (where t.urgent) over ())::int as urgent_total
      from task_assignees ta
      join tasks t on t.id = ta.task_id
      join groups g on g.id = t.group_id
      join buckets b on b.id = t.bucket_id
      where ta.user_id = ${userId}
        and t.completed_at is null
        -- A deactivated client leaves Home as it leaves the sidebar.
        and g.deactivated_at is null
      order by t.urgent desc, t.due_date asc nulls last, t.created_at asc, t.id
      limit ${HOME_LIMITS.tasks}
    ) p
    order by p.urgent desc, p.due_date asc nulls last, p.created_at asc, p.id
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
  unseen: UnseenMark | null;
  total: number;
  urgent_total: number;
};

/**
 * The viewer's own open time requests (Phase 32) for the "Fill in your time" rows, through the
 * finance module: one indexed query for the rows and their count, one batch of client names
 * and one of the tasks' current titles (a ticket's title is the entry's own).
 */
async function getTimeRequests(
  db: Db,
  userId: string,
): Promise<{ timeRequests: TimeRequest[]; timeRequestCount: number }> {
  const { rows, total: timeRequestCount } = await myTimeRequests(
    db,
    userId,
    HOME_LIMITS.timeRequests,
  );
  if (rows.length === 0) return { timeRequests: [], timeRequestCount };
  const [names, titles] = await Promise.all([
    db
      .select({ id: groups.id, name: groups.name })
      .from(groups)
      .where(inArray(groups.id, [...new Set(rows.flatMap((r) => (r.groupId ? [r.groupId] : [])))])),
    getTaskTitles(
      db,
      rows.flatMap((r) => (r.taskId ? [r.taskId] : [])),
    ),
  ]);
  const groupName = new Map(names.map((g) => [g.id, g.name]));
  return {
    timeRequests: rows.map((r) => ({
      ...r,
      title: (r.taskId ? titles.get(r.taskId) : undefined) ?? r.title,
      groupName: r.groupId === null ? null : (groupName.get(r.groupId) ?? ''),
    })),
    timeRequestCount,
  };
}

export async function getAssignedTasks(db: Db, userId: string): Promise<AssignedTasks> {
  const [rows, time] = await Promise.all([
    db.execute<Row>(assignedSql(userId)).then((r) => [...r]),
    getTimeRequests(db, userId),
  ]);
  const first = rows[0];
  return {
    ...time,
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
      unseen: r.unseen,
    })),
  };
}

/**
 * The header's Tasks count (2026-10-17): the tasks with a change the viewer has not seen yet,
 * completed ones too, until they open them (`unseen.ts`). Reads
 * `notification_events_unseen_task_idx`.
 */
export function unseenTaskCountSql(userId: string): SQL {
  return sql`
    select count(*)::int as total
    from (${unseenTaskIdsSql(userId)}) x
    join tasks t on t.id = x.task_id
    where ${liveGroupSql(sql`t.group_id`)}
  `;
}

export async function countUnseenTasks(db: Db, userId: string): Promise<number> {
  const [row] = [...(await db.execute<{ total: number }>(unseenTaskCountSql(userId)))];
  return row?.total ?? 0;
}
