import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import {
  TaskDtoSchema,
  type SessionUser,
  type TaskCreate,
  type TaskDetailDto,
  type TaskDto,
  type TaskPatch,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { attachFiles, deleteFiles, getFilesForGroup, type FileDeps } from '../files/service.js';
import { isGroupPerson } from '../groups/service.js';
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

const MAX_ASSIGNEES = 10;

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
  const [task] = await selectTasks(db, eq(tasks.id, id));
  if (!task) return null;
  const [[extra], attachments] = await Promise.all([
    db.select({ description: tasks.description }).from(tasks).where(eq(tasks.id, id)),
    db
      .select({ fileId: taskAttachments.fileId })
      .from(taskAttachments)
      .where(eq(taskAttachments.taskId, id))
      .orderBy(asc(taskAttachments.fileId)),
  ]);
  const files = await getFilesForGroup(
    db,
    task.groupId,
    attachments.map((a) => a.fileId),
  );
  return { ...task, description: extra?.description ?? '', files, sourceMessage: null };
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
): Promise<TaskDetailDto> {
  const { db } = deps;
  const expected = new Date(patch.updatedAt);
  if (Number.isNaN(expected.getTime())) throw new TaskChangedError();
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

  await deleteFiles(deps, removedFiles);
  const task = await getTask(db, id);
  if (!task) throw new NotFoundError(); // deleted right after this edit committed
  return task;
}

/** Deletes a task, then its files (rows and storage) after the commit. */
export async function deleteTask(deps: TaskDeps, id: string): Promise<{ groupId: string }> {
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
  await deleteFiles(deps, fileIds);
  return { groupId };
}
