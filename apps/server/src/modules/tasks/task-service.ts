import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  TaskDtoSchema,
  type BucketKind,
  type BucketLabel,
  type SessionUser,
  type TaskCreate,
  type TaskDetailDto,
  type TaskDto,
  type TaskMove,
  type TaskMovedPayload,
  type TaskPatch,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { attachFiles, deleteFiles, getFilesForGroup, type FileDeps } from '../files/service.js';
import { getGroup, isGroupPerson } from '../groups/service.js';
import { recordNotifications } from '../notifications/service.js';
import { keyAfter } from './positions.js';
import { buckets, taskAssignees, taskAttachments, tasks } from './schema.js';
import { ensureBoard, lockBuckets, selectTasks, type Tx } from './service.js';

export type TaskDeps = FileDeps;

/** The task (or the bucket a task should go to) does not exist, or is not in that group. */
export class NotFoundError extends Error {
  constructor() {
    super('Not found');
    this.name = 'NotFoundError';
  }
}

/** An assignee is not one of the group's people, or there are more than 10. */
export class InvalidAssigneeError extends Error {
  constructor() {
    super('Invalid assignee');
    this.name = 'InvalidAssigneeError';
  }
}

/** The task was edited since the version the caller had (`updatedAt` differs). */
export class TaskChangedError extends Error {
  constructor() {
    super('The task was changed by someone else');
    this.name = 'TaskChangedError';
  }
}

/** A move that cannot be placed: `afterTaskId` is not in the target bucket, or is the task itself. */
export class ValidationError extends Error {
  constructor() {
    super('Invalid move');
    this.name = 'ValidationError';
  }
}

const MAX_ASSIGNEES = 10;

/** Called when deleting removed files fails after the commit; the write itself has succeeded. */
export type CleanupOptions = { onFileCleanupError?: (error: unknown) => void };

/**
 * Post-commit file deletion is best effort: the task change is committed, so a failure here is
 * reported to `onFileCleanupError` and never fails the caller.
 */
async function cleanUpFiles(
  deps: TaskDeps,
  fileIds: string[],
  options: CleanupOptions,
): Promise<void> {
  try {
    await deleteFiles(deps, fileIds);
  } catch (error) {
    options.onFileCleanupError?.(error);
  }
}

/** The board shape of a task: the detail without description, files and source message. */
export function toTaskDto(detail: TaskDetailDto): TaskDto {
  return TaskDtoSchema.parse(detail);
}

/** Throws `InvalidAssigneeError` unless every id is a person of the group. */
async function checkAssignees(tx: Tx, groupId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    if (!(await isGroupPerson(tx, groupId, id))) throw new InvalidAssigneeError();
  }
}

/** `task.assigned` to the new assignees, never to the actor. In the write's transaction. */
async function notifyAssigned(
  tx: Tx,
  actor: SessionUser,
  task: { id: string; groupId: string; title: string },
  added: string[],
): Promise<void> {
  await recordNotifications(tx, {
    kind: 'task.assigned',
    groupId: task.groupId,
    recipients: added.filter((id) => id !== actor.id),
    payload: { taskId: task.id, groupId: task.groupId, title: task.title, actorName: actor.name },
  });
}

/** Group and creator of a task, for permission checks; null when it does not exist. */
export async function getTaskRef(
  db: Db,
  id: string,
): Promise<{ groupId: string; createdBy: string } | null> {
  const [row] = await db
    .select({ groupId: tasks.groupId, createdBy: tasks.createdBy })
    .from(tasks)
    .where(eq(tasks.id, id));
  return row ?? null;
}

/** A task with description and files. `sourceMessage` is always null in this phase. */
export async function getTask(db: Db, id: string): Promise<TaskDetailDto | null> {
  // The board shape and the detail-only columns (description, attached file ids) in parallel.
  const [[task], [extra]] = await Promise.all([
    selectTasks(db, eq(tasks.id, id)),
    db
      .select({
        description: tasks.description,
        fileIds: sql<string[]>`coalesce((
          select array_agg(${taskAttachments.fileId} order by ${taskAttachments.fileId})
          from ${taskAttachments} where ${taskAttachments.taskId} = ${tasks.id}
        ), '{}')`,
      })
      .from(tasks)
      .where(eq(tasks.id, id)),
  ]);
  if (!task || !extra) return null;
  const files = await getFilesForGroup(db, task.groupId, extra.fileIds);
  return { ...task, description: extra.description, files, sourceMessage: null };
}

/**
 * Creates a task at the end of `bucketId` (default To do) in one transaction. The target bucket
 * is locked and read again, so a bucket deleted meanwhile answers `NotFoundError`.
 */
export async function createTask(
  deps: TaskDeps,
  actor: SessionUser,
  groupId: string,
  input: TaskCreate,
): Promise<TaskDetailDto> {
  const { db } = deps;
  await ensureBoard(db, groupId);
  const assigneeIds = [...new Set(input.assigneeIds)];
  const fileIds = [...new Set(input.fileIds)];
  if (assigneeIds.length > MAX_ASSIGNEES) throw new InvalidAssigneeError();

  const id = await db.transaction(async (tx) => {
    const target = input.bucketId
      ? and(eq(buckets.id, input.bucketId), eq(buckets.groupId, groupId))
      : and(eq(buckets.groupId, groupId), eq(buckets.kind, 'todo'));
    const [found] = await tx.select({ id: buckets.id }).from(buckets).where(target);
    if (!found) throw new NotFoundError();
    const [bucket] = await lockBuckets(tx, [found.id]);
    if (!bucket) throw new NotFoundError();

    const [last] = await tx
      .select({ position: tasks.position })
      .from(tasks)
      .where(eq(tasks.bucketId, bucket.id))
      .orderBy(desc(tasks.position))
      .limit(1);
    await checkAssignees(tx, groupId, assigneeIds);

    const now = new Date();
    const taskId = randomUUID();
    await tx.insert(tasks).values({
      id: taskId,
      groupId,
      bucketId: bucket.id,
      position: keyAfter(last?.position ?? null, null),
      title: input.title,
      description: input.description,
      createdBy: actor.id,
      dueDate: input.dueDate,
      urgent: input.urgent,
      completedAt: bucket.kind === 'done' ? now : null,
      sourceMessageId: null,
      createdAt: now,
      updatedAt: now,
    });
    if (assigneeIds.length > 0) {
      await tx.insert(taskAssignees).values(assigneeIds.map((userId) => ({ taskId, userId })));
    }
    if (fileIds.length > 0) {
      await attachFiles(tx, groupId, fileIds, actor.id);
      await tx.insert(taskAttachments).values(fileIds.map((fileId) => ({ taskId, fileId })));
    }
    await notifyAssigned(tx, actor, { id: taskId, groupId, title: input.title }, assigneeIds);
    return taskId;
  });
  return (await getTask(db, id))!;
}

/**
 * Edits a task. One conditional update on `updated_at` decides: zero rows answers
 * `TaskChangedError` when the task exists, else `NotFoundError`. `assigneeIds` and `fileIds` are
 * the full new lists; only ids not already on the task are checked. Removed files are deleted
 * after the commit.
 */
export async function updateTask(
  deps: TaskDeps,
  actor: SessionUser,
  id: string,
  patch: TaskPatch,
  options: CleanupOptions = {},
): Promise<TaskDetailDto> {
  const { db } = deps;
  const expected = new Date(patch.updatedAt);
  if (patch.assigneeIds && new Set(patch.assigneeIds).size > MAX_ASSIGNEES) {
    throw new InvalidAssigneeError();
  }

  const removedFiles = await db.transaction(async (tx) => {
    // Always strictly later than the edited version, even within the same millisecond.
    const updatedAt = new Date(Math.max(Date.now(), expected.getTime() + 1));
    const [row] = await tx
      .update(tasks)
      .set({
        ...(patch.title !== undefined && { title: patch.title }),
        ...(patch.description !== undefined && { description: patch.description }),
        ...(patch.dueDate !== undefined && { dueDate: patch.dueDate }),
        ...(patch.urgent !== undefined && { urgent: patch.urgent }),
        updatedAt,
      })
      .where(and(eq(tasks.id, id), eq(tasks.updatedAt, expected)))
      .returning({ id: tasks.id, groupId: tasks.groupId, title: tasks.title });
    if (!row) {
      const [exists] = await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, id));
      throw exists ? new TaskChangedError() : new NotFoundError();
    }

    if (patch.assigneeIds) {
      const wanted = [...new Set(patch.assigneeIds)];
      const current = (
        await tx
          .select({ userId: taskAssignees.userId })
          .from(taskAssignees)
          .where(eq(taskAssignees.taskId, id))
      ).map((r) => r.userId);
      const added = wanted.filter((userId) => !current.includes(userId));
      const removed = current.filter((userId) => !wanted.includes(userId));
      await checkAssignees(tx, row.groupId, added);
      if (removed.length > 0) {
        await tx
          .delete(taskAssignees)
          .where(and(eq(taskAssignees.taskId, id), inArray(taskAssignees.userId, removed)));
      }
      if (added.length > 0) {
        await tx.insert(taskAssignees).values(added.map((userId) => ({ taskId: id, userId })));
      }
      await notifyAssigned(tx, actor, row, added);
    }

    if (!patch.fileIds) return [];
    const wanted = [...new Set(patch.fileIds)];
    const current = (
      await tx
        .select({ fileId: taskAttachments.fileId })
        .from(taskAttachments)
        .where(eq(taskAttachments.taskId, id))
    ).map((r) => r.fileId);
    const added = wanted.filter((fileId) => !current.includes(fileId));
    const removed = current.filter((fileId) => !wanted.includes(fileId));
    if (added.length > 0) {
      await attachFiles(tx, row.groupId, added, actor.id);
      await tx.insert(taskAttachments).values(added.map((fileId) => ({ taskId: id, fileId })));
    }
    if (removed.length > 0) {
      await tx
        .delete(taskAttachments)
        .where(and(eq(taskAttachments.taskId, id), inArray(taskAttachments.fileId, removed)));
    }
    return removed;
  });

  await cleanUpFiles(deps, removedFiles, options);
  const task = await getTask(db, id);
  if (!task) throw new NotFoundError(); // deleted right after this edit committed
  return task;
}

/** Deletes a task, then its files (rows and storage, best effort) after the commit. */
export async function deleteTask(
  deps: TaskDeps,
  id: string,
  options: CleanupOptions = {},
): Promise<{ groupId: string }> {
  const { db } = deps;
  const { groupId, fileIds } = await db.transaction(async (tx) => {
    // Lock the task first: an edit attaching files right now commits before we list them.
    const [task] = await tx
      .select({ groupId: tasks.groupId })
      .from(tasks)
      .where(eq(tasks.id, id))
      .for('update');
    if (!task) throw new NotFoundError();
    const attachments = await tx
      .select({ fileId: taskAttachments.fileId })
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, id));
    await tx.delete(tasks).where(eq(tasks.id, id));
    return { groupId: task.groupId, fileIds: attachments.map((a) => a.fileId) };
  });
  await cleanUpFiles(deps, fileIds, options);
  return { groupId };
}

/** A bucket as a notification shows it: custom name, the group name for `client_review`, else null. */
function bucketLabel(
  bucket: { kind: string; name: string | null },
  groupName: string,
): BucketLabel {
  const kind = bucket.kind as BucketKind;
  if (kind === 'custom') return { kind, name: bucket.name };
  return { kind, name: kind === 'client_review' ? groupName : null };
}

/** `moved` is false when the task already sat there: nothing was written and nothing is emitted. */
export type MoveResult = { task: TaskDto; moved: boolean };

/**
 * Moves a task into `bucketId`, right after `afterTaskId` (null = first). One transaction: the
 * source and target buckets are locked first (`lockBuckets`, id order, before the task row), so
 * concurrent moves into one bucket queue and every position is computed from committed rows.
 * The task and the target bucket are read again after the locks (404 if gone meanwhile).
 * `completedAt` is set entering Completed and cleared leaving it. `updatedAt` is not touched: it
 * guards the content edited in the task form, and a drag must not invalidate an unsaved edit.
 */
export async function moveTask(
  deps: TaskDeps,
  actor: SessionUser,
  id: string,
  input: TaskMove,
): Promise<MoveResult> {
  const { db } = deps;
  if (input.afterTaskId === id) throw new ValidationError();

  const moved = await db.transaction(async (tx) => {
    const [source] = await tx
      .select({ bucketId: tasks.bucketId, groupId: tasks.groupId })
      .from(tasks)
      .where(eq(tasks.id, id));
    if (!source) throw new NotFoundError();
    const { groupId } = source;
    const locked = await lockBuckets(tx, [...new Set([source.bucketId, input.bucketId])]);
    const target = locked.find((b) => b.id === input.bucketId);
    if (!target || target.groupId !== groupId) throw new NotFoundError();

    // After the bucket locks: the task as it is now (it may have moved while this call waited).
    const [task] = await tx
      .select({
        bucketId: tasks.bucketId,
        position: tasks.position,
        title: tasks.title,
        createdBy: tasks.createdBy,
      })
      .from(tasks)
      .where(eq(tasks.id, id))
      .for('update');
    if (!task) throw new NotFoundError();
    // Normally the locked source; if another move won the race, its bucket now (not locked: only
    // the target's positions are computed, and a deleted bucket would have moved the task).
    const from =
      locked.find((b) => b.id === task.bucketId) ??
      (await tx.select().from(buckets).where(eq(buckets.id, task.bucketId)))[0];
    if (!from) throw new NotFoundError();

    let afterPosition: string | null = null;
    if (input.afterTaskId !== null) {
      const [after] = await tx
        .select({ position: tasks.position })
        .from(tasks)
        .where(and(eq(tasks.id, input.afterTaskId), eq(tasks.bucketId, target.id)));
      if (!after) throw new ValidationError();
      afterPosition = after.position;
    }
    // The first task after the anchor, the moved task included. If it is the moved task, the task
    // already sits there; otherwise it is the upper neighbour of the new position.
    const [next] = await tx
      .select({ id: tasks.id, position: tasks.position })
      .from(tasks)
      .where(
        and(
          eq(tasks.bucketId, target.id),
          afterPosition === null ? undefined : gt(tasks.position, afterPosition),
        ),
      )
      .orderBy(asc(tasks.position))
      .limit(1);
    if (next?.id === id) return false;

    const changesBucket = from.id !== target.id;
    const completedAt =
      target.kind === 'done' ? (from.kind === 'done' ? undefined : new Date()) : null;
    await tx
      .update(tasks)
      .set({
        bucketId: target.id,
        position: keyAfter(afterPosition, next?.position ?? null),
        ...(completedAt !== undefined && { completedAt }),
      })
      .where(eq(tasks.id, id));

    if (changesBucket) {
      const group = await getGroup(tx, groupId);
      const groupName = group?.name ?? '';
      const assignees = await tx
        .select({ userId: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, id));
      const payload: TaskMovedPayload = {
        taskId: id,
        groupId,
        title: task.title,
        fromBucket: bucketLabel(from, groupName),
        toBucket: bucketLabel(target, groupName),
        actorName: actor.name,
      };
      await recordNotifications(tx, {
        kind: 'task.moved',
        groupId,
        recipients: [task.createdBy, ...assignees.map((a) => a.userId)].filter(
          (userId) => userId !== actor.id,
        ),
        payload,
      });
    }
    return true;
  });

  const [task] = await selectTasks(db, eq(tasks.id, id));
  if (!task) throw new NotFoundError(); // deleted right after the move committed
  return { task, moved };
}
