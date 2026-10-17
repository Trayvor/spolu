import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import {
  TaskDtoSchema,
  type BucketKind,
  type BucketLabel,
  type MessageTaskLink,
  type SessionUser,
  type TaskCreate,
  type TaskDetailDto,
  type TaskDto,
  type TaskMove,
  type TaskMovedPayload,
  type TaskPatch,
  type TasksFromMessage,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { isDeadlock } from '../../infra/db/errors.js';
import {
  attachFiles,
  copyFile,
  deleteDetachedFiles,
  deleteFiles,
  detachFiles,
  getFilesForGroup,
  InvalidAttachmentError,
  type FileDeps,
} from '../files/service.js';
import { getSourceMessage } from '../chat/messages.js';
import { taskChatFileIds } from '../chat/service.js';
import { getGroup, isPickablePerson } from '../groups/service.js';
import { getTicketRef } from '../tickets/refs.js';
import { recordNotifications, requestDelivery } from '../notifications/service.js';
import { keyAfter, keysBefore } from './positions.js';
import { buckets, taskAssignees, taskAttachments, tasks } from './schema.js';
import { ensureBoard, lockBuckets, selectTasks, type Tx } from './service.js';

/** `jobs` asks for notification delivery after a write commits. */
export type TaskDeps = FileDeps & { jobs: JobQueue };

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
export type CleanupOptions = { onFileCleanupError: (error: unknown) => void };

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
    await deleteDetachedFiles(deps, fileIds);
  } catch (error) {
    options.onFileCleanupError(error);
  }
}

/** The board shape of a task: the detail without description, files and source message. */
export function toTaskDto(detail: TaskDetailDto): TaskDto {
  return TaskDtoSchema.parse(detail);
}

/**
 * Throws `InvalidAssigneeError` unless every id is a pickable person of the group: a client or
 * one of its managers. Callers pass only ids that are new to the task, so an existing assignee
 * who has since stopped being pickable stays on it.
 */
async function checkAssignees(tx: Tx, groupId: string, ids: string[]): Promise<void> {
  for (const id of ids) {
    if (!(await isPickablePerson(tx, groupId, id))) throw new InvalidAssigneeError();
  }
}

/**
 * `task.assigned` to the new assignees, never to the actor. In the write's transaction; returns
 * the recorded event ids, for `requestDelivery` after the commit.
 */
async function notifyAssigned(
  tx: Tx,
  actor: SessionUser,
  task: { id: string; groupId: string; title: string },
  added: string[],
): Promise<string[]> {
  return recordNotifications(tx, {
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
): Promise<{ groupId: string; createdBy: string; sourceTicketId: string | null } | null> {
  const [row] = await db
    .select({
      groupId: tasks.groupId,
      createdBy: tasks.createdBy,
      sourceTicketId: tasks.sourceTicketId,
    })
    .from(tasks)
    .where(eq(tasks.id, id));
  return row ?? null;
}

/** Titles of the given tasks, keyed by id, in one query; unknown ids are absent. */
export async function getTaskTitles(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: tasks.id, title: tasks.title })
    .from(tasks)
    .where(inArray(tasks.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r.title]));
}

/**
 * A task with description, files, the message it was made from (`sourceMessage`, null when
 * there is none or it was deleted; the chat module builds it) and the ticket it was made from
 * (`sourceTicket`, Phase 21; the tickets module builds it).
 */
export async function getTask(db: Db, id: string): Promise<TaskDetailDto | null> {
  // The board shape and the detail-only columns (description, attached file ids) in parallel.
  const [[task], [extra]] = await Promise.all([
    selectTasks(db, eq(tasks.id, id)),
    db
      .select({
        description: tasks.description,
        sourceTicketId: tasks.sourceTicketId,
        fileIds: sql<string[]>`coalesce((
          select array_agg(${taskAttachments.fileId} order by ${taskAttachments.fileId})
          from ${taskAttachments} where ${taskAttachments.taskId} = ${tasks.id}
        ), '{}')`,
      })
      .from(tasks)
      .where(eq(tasks.id, id)),
  ]);
  if (!task || !extra) return null;
  const [files, sourceMessage, sourceTicket] = await Promise.all([
    getFilesForGroup(db, task.groupId, extra.fileIds),
    task.sourceMessageId === null ? null : getSourceMessage(db, task.sourceMessageId),
    extra.sourceTicketId === null ? null : getTicketRef(db, extra.sourceTicketId, task.groupId),
  ]);
  return { ...task, description: extra.description, files, sourceMessage, sourceTicket };
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

  const { id, notified } = await db.transaction(async (tx) => {
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
      link: input.link,
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
    const notified = await notifyAssigned(
      tx,
      actor,
      { id: taskId, groupId, title: input.title },
      assigneeIds,
    );
    return { id: taskId, notified };
  });
  await requestDelivery(deps.jobs, notified);
  return (await getTask(db, id))!;
}

/** Where reviewed cards come from: a chat message, a ticket, or a message of a ticket's chat. */
export type TaskSource = {
  messageId?: string;
  ticketId?: string;
  /** The source's files the cards may copy (the message's, or the files uploaded with the ticket). */
  fileIds: string[];
};

/** The cards of a chat message (Phase 9); see `createTasksFromSource`. */
export function createTasksFromMessage(
  deps: TaskDeps,
  actor: SessionUser,
  groupId: string,
  input: Pick<TasksFromMessage, 'tasks'>,
  source: { id: string; fileIds: string[] },
): Promise<TaskDetailDto[]> {
  return createTasksFromSource(deps, actor, groupId, input, {
    messageId: source.id,
    fileIds: source.fileIds,
  });
}

/**
 * Creates the reviewed cards of a source, all or none. `source` is what the route read (it checked
 * the group and that the actor may read the source): the message and/or ticket ids and the files
 * the cards may copy. Every `messageFileIds` entry must be one of `source.fileIds` (else
 * `InvalidAttachmentError`, before anything is copied); each (card, source file) pair gets its own
 * copy owned by the actor, made before the transaction. One transaction then inserts the cards at
 * the top of To do in input order (the To do row locked, keys before its first task; `createdAt`
 * 1 ms apart), with `sourceMessageId` and `sourceTicketId`, assignees, files (review uploads and
 * copies) and `task.assigned`. If anything fails, the copies are deleted again (best effort;
 * leftovers stay unattached and the daily cleanup removes them) and the error is rethrown.
 * Returns the cards in input order.
 */
export async function createTasksFromSource(
  deps: TaskDeps,
  actor: SessionUser,
  groupId: string,
  input: Pick<TasksFromMessage, 'tasks'>,
  source: TaskSource,
): Promise<TaskDetailDto[]> {
  const { db } = deps;
  const onMessage = new Set(source.fileIds);
  const drafts = input.tasks.map((draft) => ({
    ...draft,
    assigneeIds: [...new Set(draft.assigneeIds)],
    fileIds: [...new Set(draft.fileIds)],
    messageFileIds: [...new Set(draft.messageFileIds)],
  }));
  if (drafts.some((d) => d.assigneeIds.length > MAX_ASSIGNEES)) throw new InvalidAssigneeError();
  if (drafts.some((d) => d.messageFileIds.some((id) => !onMessage.has(id)))) {
    throw new InvalidAttachmentError();
  }
  // A file uploaded in the review belongs to one card only.
  const uploaded = drafts.flatMap((d) => d.fileIds);
  if (new Set(uploaded).size < uploaded.length) throw new InvalidAttachmentError();
  await ensureBoard(db, groupId);

  // Every copy in parallel; the ones that succeeded are kept for the cleanup even if one fails.
  const pairs = drafts.flatMap((d, index) => d.messageFileIds.map((fileId) => ({ index, fileId })));
  const copied = await Promise.allSettled(
    pairs.map(({ fileId }) => copyFile(deps, { fileId, groupId, userId: actor.id })),
  );
  const copyIds = copied.flatMap((r) => (r.status === 'fulfilled' ? [r.value.id] : []));
  let ids: string[];
  let notified: string[];
  try {
    const failed = copied.find((r) => r.status === 'rejected');
    if (failed) throw failed.reason;
    // No copy failed, so `copyIds` lines up with `pairs`.
    const copiesOf = drafts.map((_, index) =>
      pairs.flatMap((pair, i) => (pair.index === index ? [copyIds[i]!] : [])),
    );
    ({ ids, notified } = await db.transaction(async (tx) => {
      const [found] = await tx
        .select({ id: buckets.id })
        .from(buckets)
        .where(and(eq(buckets.groupId, groupId), eq(buckets.kind, 'todo')));
      if (!found) throw new NotFoundError();
      const [todo] = await lockBuckets(tx, [found.id]);
      if (!todo) throw new NotFoundError();
      const [first] = await tx
        .select({ position: tasks.position })
        .from(tasks)
        .where(eq(tasks.bucketId, todo.id))
        .orderBy(asc(tasks.position))
        .limit(1);
      await checkAssignees(tx, groupId, [...new Set(drafts.flatMap((d) => d.assigneeIds))]);

      const positions = keysBefore(first?.position ?? null, drafts.length);
      const now = Date.now();
      const rows = drafts.map((draft, index) => ({
        id: randomUUID(),
        groupId,
        bucketId: todo.id,
        position: positions[index]!,
        title: draft.title,
        description: draft.description,
        createdBy: actor.id,
        dueDate: draft.dueDate,
        urgent: draft.urgent,
        link: draft.link,
        completedAt: null,
        sourceMessageId: source.messageId ?? null,
        sourceTicketId: source.ticketId ?? null,
        // Distinct, ascending in input order: the first card is the oldest (a newest-first list
        // shows them reversed; the board orders by position, not by this).
        createdAt: new Date(now + index),
        updatedAt: new Date(now + index),
      }));
      await tx.insert(tasks).values(rows);
      const assignees = rows.flatMap((row, index) =>
        drafts[index]!.assigneeIds.map((userId) => ({ taskId: row.id, userId })),
      );
      if (assignees.length > 0) await tx.insert(taskAssignees).values(assignees);
      const attachments = rows.flatMap((row, index) =>
        [...drafts[index]!.fileIds, ...copiesOf[index]!].map((fileId) => ({
          taskId: row.id,
          fileId,
        })),
      );
      if (attachments.length > 0) {
        await attachFiles(
          tx,
          groupId,
          attachments.map((a) => a.fileId),
          actor.id,
        );
        await tx.insert(taskAttachments).values(attachments);
      }
      const recipients = new Set<string>();
      for (const [index, row] of rows.entries()) {
        for (const id of await notifyAssigned(tx, actor, row, drafts[index]!.assigneeIds)) {
          recipients.add(id);
        }
      }
      return { ids: rows.map((row) => row.id), notified: [...recipients] };
    }));
  } catch (error) {
    await deleteFiles(deps, copyIds).catch(() => undefined);
    throw error;
  }
  await requestDelivery(deps.jobs, notified);
  return (await Promise.all(ids.map((id) => getTask(db, id)))).flatMap((task) =>
    task ? [task] : [],
  );
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
  options: CleanupOptions,
): Promise<TaskDetailDto> {
  const { db } = deps;
  const expected = new Date(patch.updatedAt);
  if (patch.assigneeIds && new Set(patch.assigneeIds).size > MAX_ASSIGNEES) {
    throw new InvalidAssigneeError();
  }

  let notified: string[] = [];
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
        ...(patch.link !== undefined && { link: patch.link }),
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
      notified = await notifyAssigned(tx, actor, row, added);
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
      // If the removal after the commit fails, the daily unattached-files cleanup picks them up.
      await detachFiles(tx, removed);
    }
    return removed;
  });

  await requestDelivery(deps.jobs, notified);
  await cleanUpFiles(deps, removedFiles, options);
  const task = await getTask(db, id);
  if (!task) throw new NotFoundError(); // deleted right after this edit committed
  return task;
}

/**
 * Deletes a task and detaches its files in one transaction, then deletes the files (rows and
 * storage, best effort) after the commit.
 */
export async function deleteTask(
  deps: TaskDeps,
  id: string,
  options: CleanupOptions,
): Promise<{ groupId: string; sourceMessageId: string | null; sourceTicketId: string | null }> {
  const { db } = deps;
  const deleteInTx = () =>
    db.transaction(async (tx) => {
      // Lock the task first: an edit attaching files right now commits before we list them.
      const [row] = await tx
        .select({
          groupId: tasks.groupId,
          sourceMessageId: tasks.sourceMessageId,
          sourceTicketId: tasks.sourceTicketId,
        })
        .from(tasks)
        .where(eq(tasks.id, id))
        .for('update');
      if (!row) throw new NotFoundError();
      const attachments = await tx
        .select({ fileId: taskAttachments.fileId })
        .from(taskAttachments)
        .where(eq(taskAttachments.taskId, id));
      // The task chat goes with the task (FK cascade), and with it its messages' attachments.
      const chatFileIds = await taskChatFileIds(tx, id);
      await tx.delete(tasks).where(eq(tasks.id, id));
      const ids = [...attachments.map((a) => a.fileId), ...chatFileIds];
      // If the removal after the commit fails, the daily unattached-files cleanup picks them up.
      await detachFiles(tx, ids);
      return { task: row, fileIds: ids };
    });
  // Two tasks each made from a message in the other's chat, deleted at once, lock each other's
  // rows through the set-null cascade; Postgres aborts one (40P01), which then succeeds alone.
  const { task, fileIds } = await deleteInTx().catch((error: unknown) => {
    if (!isDeadlock(error)) throw error;
    return deleteInTx();
  });
  await cleanUpFiles(deps, fileIds, options);
  return task;
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

  let notified: string[] = [];
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
      notified = await recordNotifications(tx, {
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

  await requestDelivery(deps.jobs, notified);
  const [task] = await selectTasks(db, eq(tasks.id, id));
  if (!task) throw new NotFoundError(); // deleted right after the move committed
  return { task, moved };
}

/**
 * The tasks made from a ticket, oldest first (`created_at`, then `position`), for the ticket page
 * (part 21.5): one query on `tasks_source_ticket_id_idx`.
 */
export async function listTasksFromTicket(db: Db, ticketId: string): Promise<MessageTaskLink[]> {
  const rows = await db
    .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
    .from(tasks)
    .where(eq(tasks.sourceTicketId, ticketId))
    .orderBy(asc(tasks.createdAt), asc(tasks.position), asc(tasks.id));
  return rows.map((r) => ({ id: r.id, title: r.title, completed: r.completedAt !== null }));
}

/** How many tasks were made from the ticket (Phase 21). */
export async function countTasksFromTicket(db: Db, ticketId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.sourceTicketId, ticketId));
  return row?.n ?? 0;
}
