import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { groups } from '../groups/schema.js';
import { addAdmin } from '../users/service.js';
import { buckets, tasks } from './schema.js';
import {
  createBucket,
  deleteBucket,
  ensureBoard,
  FixedBucketError,
  getBoard,
  InvalidPlacementError,
  listBuckets,
  updateBucket,
} from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });

const kinds = async (groupId: string) => (await listBuckets(db, groupId)).map((b) => b.kind);

async function bucketOf(groupId: string, kind: string) {
  await ensureBoard(db, groupId);
  const found = (await listBuckets(db, groupId)).find((b) => b.kind === kind);
  if (!found) throw new Error(`no ${kind} bucket`);
  return found;
}

describe('ensureBoard / getBoard', () => {
  it('ensureBoard creates exactly the four fixed buckets once', async () => {
    const group = await newGroup();
    await ensureBoard(db, group.id);
    await ensureBoard(db, group.id);
    expect(await kinds(group.id)).toEqual(['todo', 'egrant_review', 'client_review', 'done']);
  });

  it('two parallel getBoard calls on a new group still give four buckets', async () => {
    const group = await newGroup();
    const [a, b] = await Promise.all([getBoard(db, group.id), getBoard(db, group.id)]);
    expect(a.buckets).toHaveLength(4);
    expect(b.buckets.map((x) => x.id)).toEqual(a.buckets.map((x) => x.id));
    expect(await kinds(group.id)).toEqual(['todo', 'egrant_review', 'client_review', 'done']);
  });

  it('getBoard returns tasks with creator, assignees and file count', async () => {
    const group = await newGroup();
    const admin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    const todo = await bucketOf(group.id, 'todo');
    const now = new Date();
    await db.insert(tasks).values({
      id: randomUUID(),
      groupId: group.id,
      bucketId: todo.id,
      position: 'a0',
      title: 'First',
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    });
    const board = await getBoard(db, group.id);
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]).toMatchObject({
      title: 'First',
      groupId: group.id,
      bucketId: todo.id,
      createdBy: { id: admin.id, name: 'Ada' },
      assignees: [],
      fileCount: 0,
      createdAt: now.toISOString(),
    });
  });
});

describe('custom buckets', () => {
  it('createBucket places a new bucket after the last bucket', async () => {
    const group = await newGroup();
    const first = await createBucket(db, group.id, 'First');
    expect(await kinds(group.id)).toEqual([
      'todo',
      'egrant_review',
      'client_review',
      'done',
      'custom',
    ]);
    const second = await createBucket(db, group.id, 'Second');
    const list = await listBuckets(db, group.id);
    expect(list.map((b) => b.name)).toEqual([null, null, null, null, 'First', 'Second']);
    expect(first.position < second.position).toBe(true);
    expect(first.groupId).toBe(group.id);
  });

  it('createBucket goes after a fixed bucket that was moved last', async () => {
    const group = await newGroup();
    const custom = await createBucket(db, group.id, 'Custom');
    const todo = await bucketOf(group.id, 'todo');
    await updateBucket(db, todo.id, { afterBucketId: custom.id });
    expect((await listBuckets(db, group.id)).at(-1)?.kind).toBe('todo');
    await createBucket(db, group.id, 'New');
    expect((await listBuckets(db, group.id)).map((b) => b.name ?? b.kind)).toEqual([
      'egrant_review',
      'client_review',
      'done',
      'Custom',
      'todo',
      'New',
    ]);
  });

  it('updateBucket moves a custom bucket after eGrant review and it stays before Completed', async () => {
    const group = await newGroup();
    const custom = await createBucket(db, group.id, 'Custom');
    const review = await bucketOf(group.id, 'egrant_review');
    const moved = await updateBucket(db, custom.id, { afterBucketId: review.id });
    expect(moved?.position).toBeDefined();
    expect((await listBuckets(db, group.id)).map((b) => b.kind)).toEqual([
      'todo',
      'egrant_review',
      'custom',
      'client_review',
      'done',
    ]);
    const renamed = await updateBucket(db, custom.id, { name: 'Renamed' });
    expect(renamed?.name).toBe('Renamed');
    // after client review: still before done
    const client = await bucketOf(group.id, 'client_review');
    await updateBucket(db, custom.id, { afterBucketId: client.id });
    const list = await listBuckets(db, group.id);
    expect(list.at(-2)?.kind).toBe('custom');
    expect(list.at(-1)?.kind).toBe('done');
  });

  it('updateBucket moves any bucket, fixed ones included: after Completed, or first with null', async () => {
    const group = await newGroup();
    const custom = await createBucket(db, group.id, 'Custom');
    const done = await bucketOf(group.id, 'done');
    const todo = await bucketOf(group.id, 'todo');
    await updateBucket(db, custom.id, { afterBucketId: done.id });
    await updateBucket(db, done.id, { afterBucketId: null });
    const review = await bucketOf(group.id, 'egrant_review');
    await updateBucket(db, todo.id, { afterBucketId: review.id });
    expect(await kinds(group.id)).toEqual([
      'done',
      'egrant_review',
      'todo',
      'client_review',
      'custom',
    ]);
  });

  it("updateBucket after itself, another group's bucket or an unknown id → InvalidPlacementError", async () => {
    const group = await newGroup();
    const custom = await createBucket(db, group.id, 'Custom');
    const todo = await bucketOf(group.id, 'todo');
    await expect(updateBucket(db, todo.id, { afterBucketId: todo.id })).rejects.toBeInstanceOf(
      InvalidPlacementError,
    );
    await expect(updateBucket(db, custom.id, { afterBucketId: custom.id })).rejects.toBeInstanceOf(
      InvalidPlacementError,
    );
    const other = await newGroup();
    const foreign = await bucketOf(other.id, 'todo');
    await expect(updateBucket(db, custom.id, { afterBucketId: foreign.id })).rejects.toBeInstanceOf(
      InvalidPlacementError,
    );
    await expect(updateBucket(db, custom.id, { afterBucketId: 'nope' })).rejects.toBeInstanceOf(
      InvalidPlacementError,
    );
  });

  it('updateBucket / deleteBucket on a fixed bucket → FixedBucketError', async () => {
    const group = await newGroup();
    const todo = await bucketOf(group.id, 'todo');
    await expect(updateBucket(db, todo.id, { name: 'x' })).rejects.toBeInstanceOf(FixedBucketError);
    const review = await bucketOf(group.id, 'egrant_review');
    await expect(
      updateBucket(db, todo.id, { name: 'x', afterBucketId: review.id }),
    ).rejects.toBeInstanceOf(FixedBucketError);
    await expect(deleteBucket(db, todo.id)).rejects.toBeInstanceOf(FixedBucketError);
  });

  it('updateBucket / deleteBucket on a missing bucket → null', async () => {
    expect(await updateBucket(db, 'nope', { name: 'x' })).toBeNull();
    expect(await deleteBucket(db, 'nope')).toBeNull();
  });

  it('deleteBucket moves its tasks in order to the end of To do', async () => {
    const group = await newGroup();
    const admin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    const custom = await createBucket(db, group.id, 'Custom');
    const todo = await bucketOf(group.id, 'todo');
    const now = new Date();
    const row = (bucketId: string, position: string, title: string) => ({
      id: randomUUID(),
      groupId: group.id,
      bucketId,
      position,
      title,
      createdBy: admin.id,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(tasks)
      .values([
        row(todo.id, 'a0', 'todo-1'),
        row(todo.id, 'a1', 'todo-2'),
        row(custom.id, 'a0', 'c-1'),
        row(custom.id, 'a1', 'c-2'),
        row(custom.id, 'a2', 'c-3'),
      ]);
    expect(await deleteBucket(db, custom.id)).toEqual({ groupId: group.id });
    const rows = await db
      .select({ title: tasks.title, bucketId: tasks.bucketId, updatedAt: tasks.updatedAt })
      .from(tasks)
      .where(eq(tasks.groupId, group.id))
      .orderBy(asc(tasks.position));
    expect(rows.map((r) => r.title)).toEqual(['todo-1', 'todo-2', 'c-1', 'c-2', 'c-3']);
    expect(rows.every((r) => r.bucketId === todo.id)).toBe(true);
    expect(await kinds(group.id)).toEqual(['todo', 'egrant_review', 'client_review', 'done']);
  });

  it('concurrent createBucket calls all succeed with distinct positions', async () => {
    const group = await newGroup();
    const created = await Promise.all(
      Array.from({ length: 6 }, (_, i) => createBucket(db, group.id, `B${i}`)),
    );
    expect(new Set(created.map((b) => b.position)).size).toBe(6);
    expect(await listBuckets(db, group.id)).toHaveLength(10);
  });
});

describe('group delete', () => {
  it('deleting the group row removes buckets and tasks', async () => {
    const group = await newGroup();
    const creator = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    const todo = await bucketOf(group.id, 'todo');
    const now = new Date();
    await db.insert(tasks).values({
      id: randomUUID(),
      groupId: group.id,
      bucketId: todo.id,
      position: 'a0',
      title: 'T',
      createdBy: creator.id,
      createdAt: now,
      updatedAt: now,
    });
    await db.delete(groups).where(eq(groups.id, group.id));
    expect(await db.select().from(buckets).where(eq(buckets.groupId, group.id))).toEqual([]);
    expect(await db.select().from(tasks).where(eq(tasks.groupId, group.id))).toEqual([]);
  });
});
