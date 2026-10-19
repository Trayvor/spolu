import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../src/infra/db/client.js';
import { buckets, taskAssignees, tasks } from '../src/modules/tasks/schema.js';
import { ensureBoard } from '../src/modules/tasks/service.js';

/**
 * Inserts a task straight into the table (tests that need a task row, not the task service):
 * in To do, or in Completed with `done`.
 */
export async function insertTask(
  db: Db,
  opts: {
    groupId: string;
    createdBy: string;
    title?: string;
    description?: string;
    dueDate?: string | null;
    urgent?: boolean;
    done?: boolean;
    assignees?: string[];
    /** Phase 33: the task's project and event (until part P2 sets them through the service). */
    projectId?: string | null;
    eventId?: string | null;
  },
): Promise<string> {
  await ensureBoard(db, opts.groupId);
  const [bucket] = await db
    .select({ id: buckets.id })
    .from(buckets)
    .where(and(eq(buckets.groupId, opts.groupId), eq(buckets.kind, opts.done ? 'done' : 'todo')));
  const id = randomUUID();
  const at = new Date();
  await db.insert(tasks).values({
    id,
    groupId: opts.groupId,
    bucketId: bucket!.id,
    // A valid key: a fraction may not end in 0.
    position: `a${id.slice(0, 8)}V`,
    title: opts.title ?? 'Fix the budget table',
    description: opts.description ?? '',
    createdBy: opts.createdBy,
    dueDate: opts.dueDate ?? null,
    urgent: opts.urgent ?? false,
    completedAt: opts.done ? at : null,
    projectId: opts.projectId ?? null,
    eventId: opts.eventId ?? null,
    createdAt: at,
    updatedAt: at,
  });
  if (opts.assignees?.length) {
    await db.insert(taskAssignees).values(opts.assignees.map((userId) => ({ taskId: id, userId })));
  }
  return id;
}
