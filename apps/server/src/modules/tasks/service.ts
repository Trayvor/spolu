import { randomUUID } from 'node:crypto';
import { asc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { BoardDto, BucketDto, BucketKind, TaskDto, TaskPerson } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { FIXED_POSITIONS, keyAfter, keysAfter } from './positions.js';
import { buckets, taskAssignees, taskAttachments, tasks } from './schema.js';

type BucketRow = typeof buckets.$inferSelect;
/** The transaction handle drizzle passes to `db.transaction`. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** A fixed bucket (To do, eGrant review, Client review, Completed) cannot be renamed, moved or deleted. */
export class FixedBucketError extends Error {
  constructor() {
    super('A fixed bucket cannot be changed');
    this.name = 'FixedBucketError';
  }
}

/** `afterBucketId` is not a bucket of the same group, is the bucket itself, or is Completed. */
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
/** Tasks matching `where` as DTOs: one query, creator joined, assignees and file count as subqueries. */
export async function selectTasks(db: Db, where: SQL): Promise<TaskDto[]> {
  const rows = await db
    .select({
      id: tasks.id,
      groupId: tasks.groupId,
      bucketId: tasks.bucketId,
      position: tasks.position,
      title: tasks.title,
      urgent: tasks.urgent,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
      sourceMessageId: tasks.sourceMessageId,
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
    })
    .from(tasks)
    .innerJoin(user, eq(user.id, tasks.createdBy))
    .where(where)
    .orderBy(asc(tasks.bucketId), asc(tasks.position));
  return rows.map(({ creatorId, creatorName, ...row }) => ({
    ...row,
    completedAt: row.completedAt?.toISOString() ?? null,
    createdBy: { id: creatorId, name: creatorName },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

/** The board of a group, created on first read. Two queries after the ensure. */
export async function getBoard(db: Db, groupId: string): Promise<BoardDto> {
  await ensureBoard(db, groupId);
  const [bucketList, taskList] = await Promise.all([
    listBuckets(db, groupId),
    selectTasks(db, eq(tasks.groupId, groupId)),
  ]);
  return { buckets: bucketList, tasks: taskList };
}

/** The first position strictly after `position` among `rows` (already sorted), or null. */
function nextPositionAfter(rows: BucketRow[], position: string): string | null {
  return rows.find((r) => r.position > position)?.position ?? null;
}

/** Appends a custom bucket after the last custom one, or right after To do when there is none. */
export async function createBucket(db: Db, groupId: string, name: string): Promise<BucketDto> {
  await ensureBoard(db, groupId);
  return db.transaction(async (tx) => {
    const rows = await lockGroupBuckets(tx, groupId);
    const prev = rows.findLast((r) => r.kind === 'custom') ?? rows.find((r) => r.kind === 'todo');
    const after = prev?.position ?? FIXED_POSITIONS.todo;
    const [row] = await tx
      .insert(buckets)
      .values({
        id: randomUUID(),
        groupId,
        kind: 'custom',
        name,
        position: keyAfter(after, nextPositionAfter(rows, after)),
      })
      .returning();
    return toBucketDto(row!);
  });
}

/**
 * Renames and/or moves a custom bucket after `afterBucketId`. Null when the bucket is gone
 * (also when it was deleted while this call waited for the lock).
 */
export async function updateBucket(
  db: Db,
  id: string,
  patch: { name?: string; afterBucketId?: string },
): Promise<BucketDto | null> {
  const current = await getBucket(db, id);
  if (!current) return null;
  return db.transaction(async (tx) => {
    const rows = await lockGroupBuckets(tx, current.groupId);
    const bucket = rows.find((r) => r.id === id);
    if (!bucket) return null;
    if (bucket.kind !== 'custom') throw new FixedBucketError();

    const changes: { name?: string; position?: string } = {};
    if (patch.name !== undefined) changes.name = patch.name;
    if (patch.afterBucketId !== undefined) {
      const after = rows.find((r) => r.id === patch.afterBucketId);
      if (!after || after.id === id || after.kind === 'done') throw new InvalidPlacementError();
      const others = rows.filter((r) => r.id !== id);
      changes.position = keyAfter(after.position, nextPositionAfter(others, after.position));
    }
    const [row] = await tx.update(buckets).set(changes).where(eq(buckets.id, id)).returning();
    return toBucketDto(row!);
  });
}

/**
 * Deletes a custom bucket; its tasks, in their order, go to the end of To do. Null when the
 * bucket is already gone.
 */
export async function deleteBucket(db: Db, id: string): Promise<{ groupId: string } | null> {
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
    await tx.delete(buckets).where(eq(buckets.id, id));
    return { groupId: current.groupId };
  });
}
