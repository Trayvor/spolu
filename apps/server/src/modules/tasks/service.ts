import { linkedCountSql } from '../knowledge/links.js';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import {
  BOARD_DONE_PAGE,
  type BoardUnseen,
  type BoardDonePage,
  type BoardDto,
  type BucketDto,
  type BucketKind,
  type MessageTaskLink,
  type ProjectFilter,
  type TaskDto,
  type TaskPerson,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { unseenTaskIdsSql } from '../notifications/unseen.js';
import { projectRefs } from '../projects/refs.js';
import { reminderSets, reminderTimes } from '../reminders/schema.js';
import { user } from '../users/schema.js';
import { taskProjectFilter } from './project-links.js';
import { FIXED_POSITIONS, keyAfter, keysAfter } from './positions.js';
import { buckets, taskAssignees, taskAttachments, tasks } from './schema.js';
import type { AuditChanges } from '@spolu/shared';
import type { AuditActor } from '../audit/actor.js';
import { recordAudit, type AuditEntry } from '../audit/service.js';
import { bucketAuditLabel } from './audit.js';

type BucketRow = typeof buckets.$inferSelect;
/** The transaction handle drizzle passes to `db.transaction`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The task's own people: its creator and its assignees, in one query ([] for an unknown task).
 * A task chat's plain messages notify them (owner 2026-10-18), with the chat's writers and the
 * people named in it (the chat module adds those).
 */
export async function taskPeopleIds(db: Db, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tasks.createdBy })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .union(
      db
        .select({ id: taskAssignees.userId })
        .from(taskAssignees)
        .where(eq(taskAssignees.taskId, taskId)),
    );
  return rows.map((r) => r.id);
}

/** A fixed bucket (To do, eGrant review, Client review, Completed) cannot be renamed or deleted. */
export class FixedBucketError extends Error {
  constructor() {
    super('A fixed bucket cannot be changed');
    this.name = 'FixedBucketError';
  }
}

/** `afterBucketId` is not a bucket of the same group, or is the bucket itself. */
export class InvalidPlacementError extends Error {
  constructor() {
    super('A bucket cannot be placed after that bucket');
    this.name = 'InvalidPlacementError';
  }
}

const toBucketDto = (row: BucketRow): BucketDto => ({
  id: row.id,
  groupId: row.groupId,
  kind: row.kind as BucketKind,
  name: row.name,
  position: row.position,
});

/**
 * Creates the four fixed buckets of a group on first use. One statement with `on conflict do
 * nothing`: two parallel first reads cannot produce duplicates or an error.
 */
export async function ensureBoard(db: Db, groupId: string): Promise<void> {
  const fixed = Object.entries(FIXED_POSITIONS) as [Exclude<BucketKind, 'custom'>, string][];
  await db
    .insert(buckets)
    .values(
      fixed.map(([kind, position]) => ({ id: randomUUID(), groupId, kind, name: null, position })),
    )
    .onConflictDoNothing();
}

/**
 * Locks the given bucket rows (`select … for update`, ordered by id so two writers never
 * deadlock). Every write that computes a position locks its buckets first.
 *
 * Lock order rule: a transaction locks bucket rows (by id) BEFORE any task row, never the
 * other way round. Writes that lock a task row (edit, delete) take no bucket lock afterwards.
 */
export async function lockBuckets(tx: Tx, ids: string[]): Promise<BucketRow[]> {
  if (ids.length === 0) return [];
  return tx
    .select()
    .from(buckets)
    .where(inArray(buckets.id, ids))
    .orderBy(asc(buckets.id))
    .for('update');
}

/**
 * Locks every bucket row of a group, in id order, and returns them sorted by position. The four
 * fixed rows always exist, so concurrent writers queue here. The rows are read again after the
 * lock: under READ COMMITTED the locking statement does not see a bucket another writer
 * committed while this one waited, a new statement does.
 */
async function lockGroupBuckets(tx: Tx, groupId: string): Promise<BucketRow[]> {
  await tx
    .select({ id: buckets.id })
    .from(buckets)
    .where(eq(buckets.groupId, groupId))
    .orderBy(asc(buckets.id))
    .for('update');
  return tx
    .select()
    .from(buckets)
    .where(eq(buckets.groupId, groupId))
    .orderBy(asc(buckets.position));
}

export async function listBuckets(db: Db, groupId: string): Promise<BucketDto[]> {
  const rows = await db
    .select()
    .from(buckets)
    .where(eq(buckets.groupId, groupId))
    .orderBy(asc(buckets.position));
  return rows.map(toBucketDto);
}

export async function getBucket(db: Db, id: string): Promise<BucketDto | null> {
  const [row] = await db.select().from(buckets).where(eq(buckets.id, id));
  return row ? toBucketDto(row) : null;
}

// Deliberate read-only exception to "no other module's tables" (the same as `listGroups`):
// names of creators and assignees come from a join on `user`, so a board is a fixed number of
// queries. Writes to users go through the users service.
/**
 * Tasks matching `where` as DTOs (at most `limit`, by bucket and position): one query, creator
 * joined, assignees, file count and upcoming reminder count as subqueries; plus one `projectRefs`
 * query for the page's projects and events (none when no task has one).
 */
export async function selectTasks(db: Db, where: SQL, limit?: number): Promise<TaskDto[]> {
  const query = db
    .select({
      id: tasks.id,
      groupId: tasks.groupId,
      bucketId: tasks.bucketId,
      position: tasks.position,
      title: tasks.title,
      urgent: tasks.urgent,
      dueDate: tasks.dueDate,
      link: tasks.link,
      completedAt: tasks.completedAt,
      sourceMessageId: tasks.sourceMessageId,
      projectId: tasks.projectId,
      eventId: tasks.eventId,
      createdAt: tasks.createdAt,
      updatedAt: tasks.updatedAt,
      creatorId: user.id,
      creatorName: user.name,
      assignees: sql<TaskPerson[]>`coalesce((
        select json_agg(json_build_object('id', ${user.id}, 'name', ${user.name}) order by ${user.name}, ${user.id})
        from ${taskAssignees}
        join ${user} on ${user.id} = ${taskAssignees.userId}
        where ${taskAssignees.taskId} = ${tasks.id}
      ), '[]'::json)`,
      fileCount: sql<number>`(
        select count(*)::int from ${taskAttachments} where ${taskAttachments.taskId} = ${tasks.id}
      )`,
      // The same read-only exception as the `user` join: the board card's reminder bell, one
      // correlated count on `reminder_sets_task_unique` and `reminder_times_set_at_idx`.
      upcomingReminders: sql<number>`(
        select count(*)::int from ${reminderSets}
        join ${reminderTimes} on ${reminderTimes.setId} = ${reminderSets.id}
        where ${reminderSets.taskId} = ${tasks.id} and ${reminderTimes.firedAt} is null
      )`,
      // Knowledge module's SQL fragment (one correlated count per card, no N+1).
      knowledgeCount: linkedCountSql(sql`${tasks.id}`, sql`${tasks.groupId}`),
    })
    .from(tasks)
    .innerJoin(user, eq(user.id, tasks.createdBy))
    .where(where)
    .orderBy(asc(tasks.bucketId), asc(tasks.position));
  const rows = await (limit === undefined ? query : query.limit(limit));
  // Phase 33 part P2: the project and event names and colours, one query for the page.
  const refs = await projectRefs(db, rows);
  return rows.map(({ creatorId, creatorName, projectId, eventId, ...row }) => ({
    ...row,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdBy: { id: creatorId, name: creatorName },
    project: refs.project(projectId),
    event: refs.event(eventId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/**
 * How many open tasks (not in Completed) of the group are assigned to the user: one indexed count
 * (`task_assignees_user_id_idx`), for the yellow "assigned to me" pill on the Tasks tab.
 */
/**
 * The tasks of the group with a change the user has not seen (2026-10-17), for the board's
 * marks: one statement, driven by the user's own counted events (`unseen.ts`), not by the board.
 */
export function boardUnseenSql(userId: string, groupId: string): SQL {
  return sql`
    select t.id, x.message
    from (${unseenTaskIdsSql(userId)}) x
    join tasks t on t.id = x.task_id
    where t.group_id = ${groupId}
    order by t.id
  `;
}

export async function listUnseenTaskIds(
  db: Db,
  userId: string,
  groupId: string,
): Promise<BoardUnseen> {
  const rows = [
    ...(await db.execute<{ id: string; message: boolean }>(boardUnseenSql(userId, groupId))),
  ];
  return {
    taskIds: rows.map((r) => r.id),
    messageTaskIds: rows.filter((r) => r.message).map((r) => r.id),
  };
}

/**
 * The tasks made from each of the given messages, oldest first (`created_at`, then `position`):
 * one query on `tasks_source_message_id_idx`. Messages without tasks are absent from the map.
 */
export async function listTasksForMessages(
  db: Db,
  messageIds: string[],
): Promise<Map<string, MessageTaskLink[]>> {
  const byMessage = new Map<string, MessageTaskLink[]>();
  if (messageIds.length === 0) return byMessage;
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      completedAt: tasks.completedAt,
      messageId: tasks.sourceMessageId,
    })
    .from(tasks)
    .where(inArray(tasks.sourceMessageId, messageIds))
    .orderBy(asc(tasks.createdAt), asc(tasks.position), asc(tasks.id));
  for (const row of rows) {
    const link = { id: row.id, title: row.title, completed: row.completedAt !== null };
    const list = byMessage.get(row.messageId!);
    if (list) list.push(link);
    else byMessage.set(row.messageId!, [link]);
  }
  return byMessage;
}

/**
 * The first `limit` tasks of the Completed bucket after `after` (a position; null = from the
 * top), in column order, and the cursor of the next page (null on the last). One query on
 * `tasks_bucket_position_unique`, one row more than the page to know whether more follow.
 */
async function donePage(
  db: Db,
  doneBucketId: string,
  after: string | null,
  limit: number,
  filter: ProjectFilter,
): Promise<BoardDonePage> {
  const rows = await selectTasks(
    db,
    and(
      eq(tasks.bucketId, doneBucketId),
      after === null ? undefined : gt(tasks.position, after),
      taskProjectFilter(filter),
    )!,
    limit + 1,
  );
  const page = rows.slice(0, limit);
  return { tasks: page, next: rows.length > limit ? page.at(-1)!.position : null };
}

/**
 * The board of a group, its fixed buckets created on the first read (a read that finds them
 * writes nothing). Every open task (`tasks_open_group_idx`), and the Completed column paged
 * (Phase 27 S8): its first `done` tasks in column order, the total and the next page's cursor.
 * Four queries on a warm board, whatever the number of completed tasks (and one `projectRefs`
 * for each of the two task reads). `project` and `event` (Phase 33 part P2) narrow the open
 * tasks, the Completed page and its total alike.
 */
export async function getBoard(
  db: Db,
  groupId: string,
  opts: { done?: number } & ProjectFilter = {},
): Promise<BoardDto> {
  let bucketList = await listBuckets(db, groupId);
  if (!bucketList.some((b) => b.kind === 'done')) {
    await ensureBoard(db, groupId);
    bucketList = await listBuckets(db, groupId);
  }
  const doneId = bucketList.find((b) => b.kind === 'done')!.id;
  const filter = taskProjectFilter(opts);
  const [open, done, [count]] = await Promise.all([
    selectTasks(db, and(eq(tasks.groupId, groupId), isNull(tasks.completedAt), filter)!),
    donePage(db, doneId, null, opts.done ?? BOARD_DONE_PAGE, opts),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(tasks)
      .where(and(eq(tasks.bucketId, doneId), filter)),
  ]);
  return {
    buckets: bucketList,
    // A task in Completed always has `completedAt`; the filter keeps a stray one out of both.
    tasks: [...open.filter((t) => t.bucketId !== doneId), ...done.tasks],
    done: { total: count?.n ?? 0, next: done.next },
  };
}

/** "Show more" in the Completed column: the next page after `after` (see `getBoard`). */
export async function getDonePage(
  db: Db,
  groupId: string,
  after: string,
  filter: ProjectFilter = {},
): Promise<BoardDonePage> {
  const doneId = (await listBuckets(db, groupId)).find((b) => b.kind === 'done')?.id;
  if (!doneId) return { tasks: [], next: null };
  return donePage(db, doneId, after, BOARD_DONE_PAGE, filter);
}

/** The first position strictly after `position` among `rows` (already sorted), or null. */
function nextPositionAfter(rows: BucketRow[], position: string): string | null {
  return rows.find((r) => r.position > position)?.position ?? null;
}

/** Appends a custom bucket after the last bucket, fixed or custom: where "Add column" sits. */
export async function createBucket(
  db: Db,
  groupId: string,
  name: string,
  by?: AuditActor,
): Promise<BucketDto> {
  await ensureBoard(db, groupId);
  return db.transaction(async (tx) => {
    const rows = await lockGroupBuckets(tx, groupId);
    const last = rows.at(-1); // rows are sorted by position; the four fixed ones always exist
    const [row] = await tx
      .insert(buckets)
      .values({
        id: randomUUID(),
        groupId,
        kind: 'custom',
        name,
        position: keyAfter(last?.position ?? null, null),
      })
      .returning();
    if (by) await recordAudit(tx, by, [bucketEntry(row!, 'created', { name: { to: name } })]);
    return toBucketDto(row!);
  });
}

function bucketEntry(
  b: BucketRow,
  action: 'created' | 'renamed' | 'deleted',
  changes: AuditChanges = {},
): AuditEntry {
  return {
    entityType: 'bucket',
    entityId: b.id,
    entityLabel: bucketAuditLabel(b),
    groupId: b.groupId,
    action,
    changes,
  };
}

/**
 * Renames a custom bucket and/or moves any bucket, fixed ones included, after `afterBucketId`
 * (null = first). Null when the bucket is gone (also when it was deleted while this call waited
 * for the lock).
 */
export async function updateBucket(
  db: Db,
  id: string,
  patch: { name?: string; afterBucketId?: string | null },
  by?: AuditActor,
): Promise<BucketDto | null> {
  const current = await getBucket(db, id);
  if (!current) return null;
  return db.transaction(async (tx) => {
    const rows = await lockGroupBuckets(tx, current.groupId);
    const bucket = rows.find((r) => r.id === id);
    if (!bucket) return null;
    if (patch.name !== undefined && bucket.kind !== 'custom') throw new FixedBucketError();

    const changes: { name?: string; position?: string } = {};
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.afterBucketId === null) {
      const first = rows.find((r) => r.id !== id);
      changes.position = keyAfter(null, first?.position ?? null);
    } else if (patch.afterBucketId !== undefined) {
      const after = rows.find((r) => r.id === patch.afterBucketId);
      if (!after || after.id === id) throw new InvalidPlacementError();
      const others = rows.filter((r) => r.id !== id);
      changes.position = keyAfter(after.position, nextPositionAfter(others, after.position));
    }
    const [row] = await tx.update(buckets).set(changes).where(eq(buckets.id, id)).returning();
    // A rename is recorded; reordering columns is not.
    if (by && changes.name !== undefined && changes.name !== bucket.name) {
      await recordAudit(tx, by, [
        bucketEntry(row!, 'renamed', { name: { from: bucket.name, to: changes.name } }),
      ]);
    }
    return toBucketDto(row!);
  });
}

/**
 * Deletes a custom bucket; its tasks, in their order, go to the end of To do. Null when the
 * bucket is already gone.
 */
export async function deleteBucket(
  db: Db,
  id: string,
  by?: AuditActor,
): Promise<{ groupId: string } | null> {
  const current = await getBucket(db, id);
  if (!current) return null;
  return db.transaction(async (tx) => {
    const rows = await lockGroupBuckets(tx, current.groupId);
    const bucket = rows.find((r) => r.id === id);
    if (!bucket) return null;
    if (bucket.kind !== 'custom') throw new FixedBucketError();
    const todo = rows.find((r) => r.kind === 'todo')!;

    const moving = await tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(eq(tasks.bucketId, id))
      .orderBy(asc(tasks.position));
    if (moving.length > 0) {
      const [last] = await tx
        .select({ position: tasks.position })
        .from(tasks)
        .where(eq(tasks.bucketId, todo.id))
        .orderBy(sql`${tasks.position} desc`)
        .limit(1);
      const keys = keysAfter(last?.position ?? null, moving.length);
      for (const [i, task] of moving.entries()) {
        await tx
          .update(tasks)
          .set({ bucketId: todo.id, position: keys[i]! })
          .where(eq(tasks.id, task.id));
      }
    }
    if (by)
      await recordAudit(tx, by, [bucketEntry(bucket, 'deleted', { name: { from: bucket.name } })]);
    await tx.delete(buckets).where(eq(buckets.id, id));
    return { groupId: current.groupId };
  });
}
