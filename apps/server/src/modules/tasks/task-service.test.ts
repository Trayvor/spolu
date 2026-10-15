import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { TaskCreateSchema, type SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createDiskStorage } from '../../infra/storage/disk-storage.js';
import type { Storage } from '../../infra/storage/index.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createFile, getFile, InvalidAttachmentError } from '../files/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { createBucket, deleteBucket, ensureBoard, getBoard, listBuckets } from './service.js';
import {
  createTask as createTaskWith,
  deleteTask,
  getTask,
  InvalidAssigneeError,
  NotFoundError,
  TaskChangedError,
  updateTask,
  type TaskDeps,
} from './task-service.js';

const { db, close } = createDb(testDatabaseUrl);
let dir: string;
let storage: Storage;
let deps: TaskDeps;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spolu-tasks-'));
  storage = createDiskStorage(dir, 'test-secret');
  deps = { db, storage };
});
afterAll(async () => {
  await close();
  await rm(dir, { recursive: true, force: true });
});

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });

async function newAdmin(name = 'Ada'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const admin = await addAdmin(db, { email, name });
  return { id: admin.id, email, name, role: 'admin' };
}

async function newClient(groupId: string, name = 'Cleo'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(db, groupId, id);
  return { id, email, name, role: 'client' };
}

const upload = (groupId: string, owner: SessionUser, name = 'a.txt') =>
  createFile(
    { db, storage },
    {
      groupId,
      uploadedBy: owner.id,
      name,
      declaredType: 'text/plain',
      body: Readable.from([Buffer.from('hello')]),
    },
  );

async function bucketOf(groupId: string, kind: string) {
  await ensureBoard(db, groupId);
  return (await listBuckets(db, groupId)).find((b) => b.kind === kind)!;
}

/** `createTask` with a draft parsed like the route does (defaults filled in). */
const createTask = (deps: TaskDeps, actor: SessionUser, groupId: string, input: object) =>
  createTaskWith(deps, actor, groupId, TaskCreateSchema.parse(input));

const getBoardTitles = async (groupId: string) =>
  (await getBoard(db, groupId)).tasks.map((t) => t.title);

/** `task.assigned` recipients of a task (payload match on `taskId`). */
async function assignedRecipients(taskId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: notificationEvents.userId, payload: notificationEvents.payload })
    .from(notificationEvents)
    .where(eq(notificationEvents.kind, 'task.assigned'));
  return rows
    .filter((r) => (r.payload as { taskId: string }).taskId === taskId)
    .map((r) => r.userId)
    .sort();
}

describe('createTask', () => {
  it('a client creates a task with only a title: in To do, at the end, creator = client', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const first = await createTask(deps, client, group.id, { title: 'One' });
    const second = await createTask(deps, client, group.id, { title: 'Two' });
    const todo = await bucketOf(group.id, 'todo');
    expect(second).toMatchObject({
      title: 'Two',
      bucketId: todo.id,
      groupId: group.id,
      createdBy: { id: client.id, name: 'Cleo' },
      assignees: [],
      files: [],
      fileCount: 0,
      description: '',
      urgent: false,
      dueDate: null,
      completedAt: null,
      sourceMessageId: null,
      sourceMessage: null,
    });
    expect(second.position > first.position).toBe(true);
  });

  it('into Completed sets completedAt', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const done = await bucketOf(group.id, 'done');
    const task = await createTask(deps, admin, group.id, { title: 'Done', bucketId: done.id });
    expect(task.bucketId).toBe(done.id);
    expect(task.completedAt).not.toBeNull();
  });

  it('a bucket of another group, or a deleted bucket → NotFoundError', async () => {
    const group = await newGroup();
    const other = await newGroup();
    const admin = await newAdmin();
    const foreign = await bucketOf(other.id, 'todo');
    await expect(
      createTask(deps, admin, group.id, { title: 'X', bucketId: foreign.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const custom = await createBucket(db, group.id, 'Gone');
    await deleteBucket(db, custom.id);
    await expect(
      createTask(deps, admin, group.id, { title: 'X', bucketId: custom.id }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('an assignee from another group → InvalidAssigneeError and nothing is created', async () => {
    const group = await newGroup();
    const other = await newGroup();
    const admin = await newAdmin();
    const stranger = await newClient(other.id);
    await expect(
      createTask(deps, admin, group.id, { title: 'Nope', assigneeIds: [stranger.id] }),
    ).rejects.toBeInstanceOf(InvalidAssigneeError);
    expect((await getBoardTitles(group.id)).length).toBe(0);
  });

  it('an active admin and a client of the group are valid assignees; urgent is kept', async () => {
    const group = await newGroup();
    const client = await newClient(group.id, 'Bea');
    const admin = await newAdmin('Abe');
    const task = await createTask(deps, client, group.id, {
      title: 'Both',
      assigneeIds: [admin.id, client.id],
      urgent: true,
      dueDate: '2026-12-31',
      description: 'Some text',
    });
    expect(task.assignees).toEqual([
      { id: admin.id, name: 'Abe' },
      { id: client.id, name: 'Bea' },
    ]);
    expect(task).toMatchObject({ urgent: true, dueDate: '2026-12-31', description: 'Some text' });
    // task.assigned goes to the admin only: the client is the actor.
    expect(await assignedRecipients(task.id)).toEqual([admin.id]);
  });

  it('a file uploaded by someone else → InvalidAttachmentError', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const admin = await newAdmin();
    const theirs = await upload(group.id, admin);
    await expect(
      createTask(deps, client, group.id, { title: 'F', fileIds: [theirs.id] }),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
  });

  it('own files are attached and listed', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const file = await upload(group.id, client, 'plan.txt');
    const task = await createTask(deps, client, group.id, { title: 'F', fileIds: [file.id] });
    expect(task.files.map((f) => f.name)).toEqual(['plan.txt']);
    expect(task.fileCount).toBe(1);
    expect((await getFile(db, file.id))!.attachedAt).not.toBeNull();
  });
});

describe('getTask', () => {
  it('null for an unknown id', async () => {
    expect(await getTask(db, randomUUID())).toBeNull();
  });
});

describe('updateTask', () => {
  it('two edits with the returned updatedAt both succeed; updatedAt grows', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const task = await createTask(deps, admin, group.id, { title: 'A' });
    const one = await updateTask(deps, admin, task.id, { title: 'B', updatedAt: task.updatedAt });
    const two = await updateTask(deps, admin, task.id, { title: 'C', updatedAt: one.updatedAt });
    expect(two.title).toBe('C');
    expect(one.updatedAt > task.updatedAt).toBe(true);
    expect(two.updatedAt > one.updatedAt).toBe(true);
  });

  it('an older updatedAt → TaskChangedError and nothing changes', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const other = await newAdmin('Ben');
    const task = await createTask(deps, admin, group.id, { title: 'A' });
    await updateTask(deps, admin, task.id, { title: 'B', updatedAt: task.updatedAt });
    await expect(
      updateTask(deps, admin, task.id, {
        title: 'Stale',
        assigneeIds: [other.id],
        updatedAt: task.updatedAt,
      }),
    ).rejects.toBeInstanceOf(TaskChangedError);
    const after = await getTask(db, task.id);
    expect(after).toMatchObject({ title: 'B', assignees: [] });
    expect(await assignedRecipients(task.id)).toEqual([]);
  });

  it('an unknown task → NotFoundError', async () => {
    const admin = await newAdmin();
    await expect(
      updateTask(deps, admin, randomUUID(), { title: 'X', updatedAt: new Date().toISOString() }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('a title edit keeps assignees, files and urgent; urgent can be cleared', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const admin = await newAdmin();
    const file = await upload(group.id, client);
    const task = await createTask(deps, client, group.id, {
      title: 'A',
      assigneeIds: [admin.id],
      fileIds: [file.id],
      urgent: true,
    });
    const edited = await updateTask(deps, client, task.id, {
      title: 'B',
      updatedAt: task.updatedAt,
    });
    expect(edited).toMatchObject({ title: 'B', urgent: true, fileCount: 1 });
    expect(edited.assignees.map((a) => a.id)).toEqual([admin.id]);
    expect(edited.files.map((f) => f.id)).toEqual([file.id]);
    const cleared = await updateTask(deps, client, task.id, {
      urgent: false,
      updatedAt: edited.updatedAt,
    });
    expect(cleared.urgent).toBe(false);
  });

  it('a removed assignee stays and does not block edits', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const client = await newClient(group.id, 'Gone Soon');
    const task = await createTask(deps, admin, group.id, {
      title: 'A',
      assigneeIds: [client.id],
    });
    await deactivateUser(db, client.id);
    const edited = await updateTask(deps, admin, task.id, {
      title: 'B',
      assigneeIds: [client.id],
      updatedAt: task.updatedAt,
    });
    expect(edited.assignees.map((a) => a.id)).toEqual([client.id]);
  });

  it('removing a file unlinks it and deletes it from storage', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const keep = await upload(group.id, client, 'keep.txt');
    const drop = await upload(group.id, client, 'drop.txt');
    const task = await createTask(deps, client, group.id, {
      title: 'A',
      fileIds: [keep.id, drop.id],
    });
    const key = (await getFile(db, drop.id))!.storageKey;
    expect(await storage.exists(key)).toBe(true);
    const edited = await updateTask(deps, client, task.id, {
      fileIds: [keep.id],
      updatedAt: task.updatedAt,
    });
    expect(edited.files.map((f) => f.id)).toEqual([keep.id]);
    expect(await getFile(db, drop.id)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it('task.assigned goes to newly added assignees only, never to the actor', async () => {
    const group = await newGroup();
    const actor = await newAdmin('Actor');
    const first = await newAdmin('First');
    const second = await newClient(group.id, 'Second');
    const task = await createTask(deps, actor, group.id, {
      title: 'A',
      assigneeIds: [actor.id, first.id],
    });
    expect(await assignedRecipients(task.id)).toEqual([first.id]);
    await updateTask(deps, actor, task.id, {
      assigneeIds: [first.id, second.id, actor.id],
      updatedAt: task.updatedAt,
    });
    expect(await assignedRecipients(task.id)).toEqual([first.id, second.id].sort());
  });

  it('a newly added assignee from another group → InvalidAssigneeError, nothing changes', async () => {
    const group = await newGroup();
    const other = await newGroup();
    const admin = await newAdmin();
    const stranger = await newClient(other.id);
    const task = await createTask(deps, admin, group.id, { title: 'A' });
    await expect(
      updateTask(deps, admin, task.id, {
        title: 'B',
        assigneeIds: [stranger.id],
        updatedAt: task.updatedAt,
      }),
    ).rejects.toBeInstanceOf(InvalidAssigneeError);
    expect((await getTask(db, task.id))!.title).toBe('A');
  });
});

describe('deleteTask', () => {
  it('deletes the task and its files from storage', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const file = await upload(group.id, client);
    const task = await createTask(deps, client, group.id, { title: 'A', fileIds: [file.id] });
    const key = (await getFile(db, file.id))!.storageKey;
    expect(await deleteTask(deps, task.id)).toEqual({ groupId: group.id });
    expect(await getTask(db, task.id)).toBeNull();
    expect(await getFile(db, file.id)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it('an unknown task → NotFoundError', async () => {
    await expect(deleteTask(deps, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });
});
