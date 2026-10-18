import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { TaskCreateSchema, TasksFromMessageSchema, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createDb } from '../../infra/db/client.js';
import { createDiskStorage } from '../../infra/storage/disk-storage.js';
import type { Storage } from '../../infra/storage/index.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { deleteMessage, getMessage, sendMessage } from '../chat/messages.js';
import { ensureGroupChannel, ensureTaskChannel, getChannel } from '../chat/service.js';
import * as filesService from '../files/service.js';
import { files } from '../files/schema.js';
import { createFile, getFile, InvalidAttachmentError } from '../files/service.js';
import { addManager, removeManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { DELIVER_JOB } from '../notifications/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { tasks } from './schema.js';
import { createBucket, deleteBucket, ensureBoard, getBoard, listBuckets } from './service.js';
import {
  createTask as createTaskWith,
  createTasksFromMessage,
  deleteTask as deleteTaskWith,
  getTask,
  getTaskRef,
  getTaskTitles,
  InvalidAssigneeError,
  moveTask,
  NotFoundError,
  TaskChangedError,
  updateTask as updateTaskWith,
  ValidationError,
  type TaskDeps,
} from './task-service.js';

vi.mock('../files/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../files/service.js')>();
  return { ...actual, deleteDetachedFiles: vi.fn(actual.deleteDetachedFiles) };
});

const actualFiles =
  await vi.importActual<typeof import('../files/service.js')>('../files/service.js');
const { db, close } = createDb(testDatabaseUrl);
// Cleanup failures must surface in tests.
const cleanup = {
  onFileCleanupError: (error: unknown) => {
    throw error;
  },
};
const updateTask = (
  ...args: [TaskDeps, SessionUser, string, Parameters<typeof updateTaskWith>[3]]
) => updateTaskWith(...args, cleanup);
const deleteTask = (deps: TaskDeps, id: string) => deleteTaskWith(deps, id, cleanup);
let dir: string;
let storage: Storage;
let deps: TaskDeps;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'spolu-tasks-'));
  storage = createDiskStorage(dir, 'test-secret');
  deps = { db, storage, jobs: { send: async () => {} } };
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
  return { id: admin.id, email, name, role: 'admin', finance: false };
}

async function newClient(groupId: string, name = 'Cleo'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(db, groupId, id);
  return { id, email, name, role: 'client', finance: false };
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
    .select({ userId: notificationEvents.userId })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.kind, 'task.assigned'),
        sql`${notificationEvents.payload}->>'taskId' = ${taskId}`,
      ),
    );
  return rows.map((r) => r.userId).sort();
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
      upcomingReminders: 0,
      description: '',
      urgent: false,
      dueDate: null,
      completedAt: null,
      sourceMessageId: null,
      sourceMessage: null,
      link: null,
    });
    expect(second.position > first.position).toBe(true);
  });

  it('stores the link on the detail and the board shape', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const task = await createTask(deps, client, group.id, {
      title: 'Linked',
      link: ' https://egrant.sk/a ',
    });
    expect(task.link).toBe('https://egrant.sk/a');
    expect((await getTask(db, task.id))!.link).toBe('https://egrant.sk/a');
    expect((await getBoard(db, group.id)).tasks[0]!.link).toBe('https://egrant.sk/a');
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
    await addManager(db, group.id, admin.id);
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

  it('assigning a non-manager admin throws InvalidAssigneeError', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const admin = await newAdmin('Nina');
    await expect(
      createTask(deps, client, group.id, { title: 'No', assigneeIds: [admin.id] }),
    ).rejects.toBeInstanceOf(InvalidAssigneeError);
  });

  it('an admin assigns admins who are not managers, the superadmin too; they are notified', async () => {
    const group = await newGroup();
    const admin = await newAdmin('Abe');
    const other = await newAdmin('Ola');
    const superadminId = randomUUID();
    await db.insert(user).values({
      id: superadminId,
      email: `${superadminId}@example.com`,
      name: 'Sue',
      role: 'superadmin',
      emailVerified: true,
    });
    const ids = [other.id, superadminId];
    const task = await createTask(deps, admin, group.id, { title: 'Any admin', assigneeIds: ids });
    expect(task.assignees.map((a) => a.id).sort()).toEqual([...ids].sort());
    expect(await assignedRecipients(task.id)).toEqual([...ids].sort());
  });

  it('assigning a manager works', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const manager = await newAdmin('Mara');
    await addManager(db, group.id, manager.id);
    const task = await createTask(deps, client, group.id, {
      title: 'Yes',
      assigneeIds: [manager.id],
    });
    expect(task.assignees).toEqual([{ id: manager.id, name: 'Mara' }]);
  });

  it('editing a task whose assignee is no longer a manager keeps them', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const manager = await newAdmin('Mara');
    await addManager(db, group.id, manager.id);
    const task = await createTask(deps, client, group.id, {
      title: 'A',
      assigneeIds: [manager.id],
    });
    await removeManager(db, group.id, manager.id);
    const edited = await updateTask(deps, client, task.id, {
      title: 'B',
      assigneeIds: [manager.id],
      updatedAt: task.updatedAt,
    });
    expect(edited.title).toBe('B');
    expect(edited.assignees.map((a) => a.id)).toEqual([manager.id]);
  });

  it('re-adding a former manager after removing them throws', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const manager = await newAdmin('Mara');
    await addManager(db, group.id, manager.id);
    const task = await createTask(deps, client, group.id, {
      title: 'A',
      assigneeIds: [manager.id],
    });
    await removeManager(db, group.id, manager.id);
    const cleared = await updateTask(deps, client, task.id, {
      assigneeIds: [],
      updatedAt: task.updatedAt,
    });
    await expect(
      updateTask(deps, client, task.id, {
        assigneeIds: [manager.id],
        updatedAt: cleared.updatedAt,
      }),
    ).rejects.toBeInstanceOf(InvalidAssigneeError);
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

describe('getTaskTitles', () => {
  it('maps known ids to titles and leaves unknown ids out', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const a = await createTask(deps, client, group.id, { title: 'Alpha' });
    const b = await createTask(deps, client, group.id, { title: 'Beta' });
    const titles = await getTaskTitles(db, [a.id, b.id, a.id, randomUUID()]);
    expect(titles).toEqual(
      new Map([
        [a.id, 'Alpha'],
        [b.id, 'Beta'],
      ]),
    );
    expect(await getTaskTitles(db, [])).toEqual(new Map());
  });
});

describe('getTask', () => {
  it('null for an unknown id', async () => {
    expect(await getTask(db, randomUUID())).toBeNull();
  });

  it('getTask returns the source message with its channel', async () => {
    const group = await newGroup();
    const ana = await newClient(group.id, 'Ana');
    const channel = await ensureGroupChannel(db, group.id);
    const send = (body: string, on = channel) =>
      sendMessage(deps as AppDeps, {
        channel: on,
        author: ana,
        data: { body, clientId: randomUUID() },
      });
    const m = (await send('Do the report')).message;
    const t = await createTask(deps, ana, group.id, { title: 'Report' });
    await db.update(tasks).set({ sourceMessageId: m.id }).where(eq(tasks.id, t.id));
    expect((await getTask(db, t.id))!.sourceMessage).toEqual({
      id: m.id,
      channelId: channel.id,
      taskId: null,
      authorName: 'Ana',
      excerpt: 'Do the report',
    });

    // A message in another task's chat: mentions read as names, the chat's task is named.
    const host = await createTask(deps, ana, group.id, { title: 'Host' });
    const taskChannel = await ensureTaskChannel(db, host);
    const inChat = (await send(`Ask <@${ana.id}>   and <@all> ${'x'.repeat(200)}`, taskChannel))
      .message;
    await db.update(tasks).set({ sourceMessageId: inChat.id }).where(eq(tasks.id, t.id));
    const source = (await getTask(db, t.id))!.sourceMessage!;
    expect(source).toMatchObject({ id: inChat.id, channelId: taskChannel.id, taskId: host.id });
    expect(source.excerpt.startsWith('Ask @Ana and @all xxx')).toBe(true);
    expect(source.excerpt).toHaveLength(141);

    // A deleted message is no source any more.
    await deleteMessage(deps as AppDeps, {
      channel: taskChannel,
      message: (await getMessage(db, inChat.id))!,
    });
    expect((await getTask(db, t.id))!.sourceMessage).toBeNull();
  });
});

describe('updateTask', () => {
  it('sets, keeps and clears the link', async () => {
    const group = await newGroup();
    const admin = await newAdmin();
    const task = await createTask(deps, admin, group.id, { title: 'A' });
    const set = await updateTask(deps, admin, task.id, {
      link: 'https://egrant.sk/x',
      updatedAt: task.updatedAt,
    });
    expect(set.link).toBe('https://egrant.sk/x');
    const kept = await updateTask(deps, admin, task.id, { title: 'B', updatedAt: set.updatedAt });
    expect(kept.link).toBe('https://egrant.sk/x');
    const cleared = await updateTask(deps, admin, task.id, {
      link: null,
      updatedAt: kept.updatedAt,
    });
    expect(cleared.link).toBeNull();
  });

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
    await addManager(db, group.id, admin.id);
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

  it('a failing post-commit file removal does not fail the edit and leaves the file unattached', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const drop = await upload(group.id, client, 'drop.txt');
    const task = await createTask(deps, client, group.id, { title: 'A', fileIds: [drop.id] });
    vi.mocked(filesService.deleteDetachedFiles).mockRejectedValueOnce(new Error('db down'));
    const onFileCleanupError = vi.fn();
    const edited = await updateTaskWith(
      deps,
      client,
      task.id,
      { fileIds: [], updatedAt: task.updatedAt },
      { onFileCleanupError },
    );
    expect(edited.files).toEqual([]);
    expect(onFileCleanupError).toHaveBeenCalledOnce();
    expect((await getFile(db, drop.id))?.attachedAt).toBeNull();
  });

  it('a file removed from a task and attached to another task before the cleanup survives', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const file = await upload(group.id, client);
    const task = await createTask(deps, client, group.id, { title: 'A', fileIds: [file.id] });
    let other = '';
    vi.mocked(filesService.deleteDetachedFiles).mockImplementationOnce(async (d, ids) => {
      other = (await createTask(deps, client, group.id, { title: 'B', fileIds: ids })).id;
      return actualFiles.deleteDetachedFiles(d, ids);
    });
    await updateTask(deps, client, task.id, { fileIds: [], updatedAt: task.updatedAt });
    expect((await getTask(db, other))!.files.map((f) => f.id)).toEqual([file.id]);
    const key = (await getFile(db, file.id))!.storageKey;
    expect(await storage.exists(key)).toBe(true);
  });

  it('task.assigned goes to newly added assignees only, never to the actor', async () => {
    const group = await newGroup();
    const actor = await newAdmin('Actor');
    const first = await newAdmin('First');
    await addManager(db, group.id, actor.id);
    await addManager(db, group.id, first.id);
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
    expect(await deleteTask(deps, task.id)).toMatchObject({
      groupId: group.id,
      sourceMessageId: null,
      sourceTicketId: null,
      sourceMeetingId: null,
    });
    expect(await getTask(db, task.id)).toBeNull();
    expect(await getFile(db, file.id)).toBeNull();
    expect(await storage.exists(key)).toBe(false);
  });

  it('a failing post-commit file removal does not fail the delete and leaves the files unattached', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const file = await upload(group.id, client);
    const task = await createTask(deps, client, group.id, { title: 'A', fileIds: [file.id] });
    vi.mocked(filesService.deleteDetachedFiles).mockRejectedValueOnce(new Error('db down'));
    const onFileCleanupError = vi.fn();
    expect(await deleteTaskWith(deps, task.id, { onFileCleanupError })).toMatchObject({
      groupId: group.id,
      sourceMessageId: null,
      sourceTicketId: null,
      sourceMeetingId: null,
    });
    expect(onFileCleanupError).toHaveBeenCalledOnce();
    expect(await getTask(db, task.id)).toBeNull();
    expect((await getFile(db, file.id))?.attachedAt).toBeNull();
  });

  it('a file of a deleted task attached to another task before the cleanup survives', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const file = await upload(group.id, client);
    const task = await createTask(deps, client, group.id, { title: 'A', fileIds: [file.id] });
    let other = '';
    vi.mocked(filesService.deleteDetachedFiles).mockImplementationOnce(async (d, ids) => {
      other = (await createTask(deps, client, group.id, { title: 'B', fileIds: ids })).id;
      return actualFiles.deleteDetachedFiles(d, ids);
    });
    await deleteTask(deps, task.id);
    expect((await getTask(db, other))!.files.map((f) => f.id)).toEqual([file.id]);
    expect(await storage.exists((await getFile(db, file.id))!.storageKey)).toBe(true);
  });

  it('an unknown task → NotFoundError', async () => {
    await expect(deleteTask(deps, randomUUID())).rejects.toBeInstanceOf(NotFoundError);
  });

  /** A message in the task's chat, by `author`, with the given files. */
  const sendInTaskChat = async (
    task: { id: string; groupId: string },
    author: SessionUser,
    fileIds: string[] = [],
  ) => {
    const channel = await ensureTaskChannel(db, task);
    const sent = await sendMessage(deps as AppDeps, {
      channel,
      author,
      data: { body: 'see the file', clientId: randomUUID(), fileIds },
    });
    return { channel, message: sent.message };
  };

  it('deleting a task deletes its chat, messages and their files', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const task = await createTask(deps, client, group.id, { title: 'A' });
    const file = await upload(group.id, client);
    const storageKey = (await getFile(db, file.id))!.storageKey;
    const { channel } = await sendInTaskChat(task, client, [file.id]);
    expect(await deleteTask(deps, task.id)).toMatchObject({
      groupId: group.id,
      sourceMessageId: null,
      sourceTicketId: null,
      sourceMeetingId: null,
    });
    expect(await getChannel(db, channel.id)).toBeNull();
    expect(await getFile(db, file.id)).toBeNull();
    expect(await storage.exists(storageKey)).toBe(false);
  });

  it("returns the task's source message id", async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const source = await createTask(deps, client, group.id, { title: 'Source' });
    const { message } = await sendInTaskChat(source, client);
    const task = await createTask(deps, client, group.id, { title: 'A' });
    await db.update(tasks).set({ sourceMessageId: message.id }).where(eq(tasks.id, task.id));
    expect(await deleteTask(deps, task.id)).toMatchObject({
      groupId: group.id,
      sourceMessageId: message.id,
      sourceTicketId: null,
      sourceMeetingId: null,
    });
  });

  it("a task made from a message in another task's chat loses only its source when that task goes", async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const t1 = await createTask(deps, client, group.id, { title: 'One' });
    const t2 = await createTask(deps, client, group.id, { title: 'Two' });
    const { message } = await sendInTaskChat(t1, client);
    await db.update(tasks).set({ sourceMessageId: message.id }).where(eq(tasks.id, t2.id));
    expect((await getTask(db, t2.id))!.sourceMessageId).toBe(message.id);
    await deleteTask(deps, t1.id);
    expect(await getTaskRef(db, t2.id)).not.toBeNull();
    expect((await getTask(db, t2.id))!.sourceMessageId).toBeNull();
  });

  it("two tasks made from messages in each other's chat can be deleted at once", async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    for (let round = 0; round < 3; round++) {
      const t1 = await createTask(deps, client, group.id, { title: 'One' });
      const t2 = await createTask(deps, client, group.id, { title: 'Two' });
      const m1 = (await sendInTaskChat(t1, client)).message;
      const m2 = (await sendInTaskChat(t2, client)).message;
      await db.update(tasks).set({ sourceMessageId: m2.id }).where(eq(tasks.id, t1.id));
      await db.update(tasks).set({ sourceMessageId: m1.id }).where(eq(tasks.id, t2.id));
      await Promise.all([deleteTask(deps, t1.id), deleteTask(deps, t2.id)]);
      expect(await getTaskRef(db, t1.id)).toBeNull();
      expect(await getTaskRef(db, t2.id)).toBeNull();
    }
  }, 15_000);
});

/** `task.moved` events of a task: recipient and payload. */
async function movedEvents(taskId: string) {
  return db
    .select({ userId: notificationEvents.userId, payload: notificationEvents.payload })
    .from(notificationEvents)
    .where(
      and(
        eq(notificationEvents.kind, 'task.moved'),
        sql`${notificationEvents.payload}->>'taskId' = ${taskId}`,
      ),
    );
}

describe('moveTask', () => {
  it('move into eGrant review after task B lands between B and the next task', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const review = await bucketOf(group.id, 'egrant_review');
    const b = await createTask(deps, client, group.id, { title: 'B', bucketId: review.id });
    const c = await createTask(deps, client, group.id, { title: 'C', bucketId: review.id });
    const x = await createTask(deps, client, group.id, { title: 'X' });

    const { task, moved } = await moveTask(deps, client, x.id, {
      bucketId: review.id,
      afterTaskId: b.id,
    });
    expect(moved).toBe(true);
    expect(task.bucketId).toBe(review.id);
    expect(task.position > b.position && task.position < c.position).toBe(true);
    expect(task.updatedAt).toBe(x.updatedAt);
    const inReview = (await getBoard(db, group.id)).tasks.filter((t) => t.bucketId === review.id);
    expect(inReview.map((t) => t.title)).toEqual(['B', 'X', 'C']);
  });

  it('afterTaskId null puts it first', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const a = await createTask(deps, client, group.id, { title: 'A' });
    const x = await createTask(deps, client, group.id, { title: 'X' });
    const { task } = await moveTask(deps, client, x.id, {
      bucketId: x.bucketId,
      afterTaskId: null,
    });
    expect(task.position < a.position).toBe(true);
    expect(await getBoardTitles(group.id)).toEqual(['X', 'A']);
  });

  it('moving to the current place is a no-op', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const admin = await newAdmin();
    const a = await createTask(deps, client, group.id, { title: 'A' });
    const x = await createTask(deps, client, group.id, { title: 'X' });
    await createTask(deps, client, group.id, { title: 'Y' });

    const after = await moveTask(deps, admin, x.id, { bucketId: x.bucketId, afterTaskId: a.id });
    expect(after.moved).toBe(false);
    expect(after.task).toMatchObject({ position: x.position, updatedAt: x.updatedAt });
    const first = await moveTask(deps, admin, a.id, { bucketId: a.bucketId, afterTaskId: null });
    expect(first.moved).toBe(false);
    expect(first.task.position).toBe(a.position);
    expect(await movedEvents(x.id)).toEqual([]);
    expect(await getBoardTitles(group.id)).toEqual(['A', 'X', 'Y']);
  });

  it('ten parallel moves after the same task give ten unique positions, all between that task and the next', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const review = await bucketOf(group.id, 'egrant_review');
    const b = await createTask(deps, client, group.id, { title: 'B', bucketId: review.id });
    const c = await createTask(deps, client, group.id, { title: 'C', bucketId: review.id });
    const moving = [];
    for (let i = 0; i < 10; i++) {
      moving.push(await createTask(deps, client, group.id, { title: `T${i}` }));
    }

    const results = await Promise.all(
      moving.map((t) => moveTask(deps, client, t.id, { bucketId: review.id, afterTaskId: b.id })),
    );
    const positions = results.map((r) => r.task.position);
    expect(new Set(positions).size).toBe(10);
    for (const p of positions) expect(p > b.position && p < c.position).toBe(true);
    const inReview = (await getBoard(db, group.id)).tasks.filter((t) => t.bucketId === review.id);
    expect(inReview).toHaveLength(12);
    expect(inReview[0]!.title).toBe('B');
    expect(inReview[11]!.title).toBe('C');
  });

  it('completedAt set entering Completed and cleared leaving it', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const done = await bucketOf(group.id, 'done');
    const x = await createTask(deps, client, group.id, { title: 'X' });
    const entered = await moveTask(deps, client, x.id, { bucketId: done.id, afterTaskId: null });
    expect(entered.task.completedAt).not.toBeNull();
    const left = await moveTask(deps, client, x.id, { bucketId: x.bucketId, afterTaskId: null });
    expect(left.task.completedAt).toBeNull();
  });

  it('task.moved goes to creator and assignees, not the actor, with bucket labels', async () => {
    const group = await newGroup();
    const creator = await newClient(group.id, 'Creator');
    const mover = await newClient(group.id, 'Mover');
    const admin = await newAdmin('Assigned Admin');
    await addManager(db, group.id, admin.id);
    const x = await createTask(deps, creator, group.id, {
      title: 'Report',
      assigneeIds: [admin.id, mover.id],
    });
    const clientReview = await bucketOf(group.id, 'client_review');

    await moveTask(deps, mover, x.id, { bucketId: clientReview.id, afterTaskId: null });
    const events = await movedEvents(x.id);
    expect(events.map((e) => e.userId).sort()).toEqual([admin.id, creator.id].sort());
    expect(events[0]!.payload).toEqual({
      taskId: x.id,
      groupId: group.id,
      title: 'Report',
      fromBucket: { kind: 'todo', name: null },
      toBucket: { kind: 'client_review', name: 'Firma' },
      actorName: 'Mover',
    });

    const custom = await createBucket(db, group.id, 'Waiting');
    await moveTask(deps, creator, x.id, { bucketId: custom.id, afterTaskId: null });
    const second = (await movedEvents(x.id)).filter(
      (e) => (e.payload as { toBucket: { kind: string } }).toBucket.kind === 'custom',
    );
    expect(second.map((e) => e.userId).sort()).toEqual([admin.id, mover.id].sort());
    expect(second[0]!.payload).toMatchObject({
      fromBucket: { kind: 'client_review', name: 'Firma' },
      toBucket: { kind: 'custom', name: 'Waiting' },
      actorName: 'Creator',
    });
  });

  it('afterTaskId from another bucket, or the task itself → ValidationError', async () => {
    const group = await newGroup();
    const client = await newClient(group.id);
    const review = await bucketOf(group.id, 'egrant_review');
    const other = await createTask(deps, client, group.id, { title: 'Other' });
    const x = await createTask(deps, client, group.id, { title: 'X' });
    await expect(
      moveTask(deps, client, x.id, { bucketId: review.id, afterTaskId: other.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      moveTask(deps, client, x.id, { bucketId: x.bucketId, afterTaskId: x.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      moveTask(deps, client, x.id, { bucketId: x.bucketId, afterTaskId: randomUUID() }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('moving a deleted task, or into a bucket of another group or a deleted bucket → NotFoundError', async () => {
    const group = await newGroup();
    const otherGroup = await newGroup();
    const client = await newClient(group.id);
    const x = await createTask(deps, client, group.id, { title: 'X' });
    const foreign = await bucketOf(otherGroup.id, 'todo');
    await expect(
      moveTask(deps, client, x.id, { bucketId: foreign.id, afterTaskId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
    const custom = await createBucket(db, group.id, 'Gone');
    await deleteBucket(db, custom.id);
    await expect(
      moveTask(deps, client, x.id, { bucketId: custom.id, afterTaskId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);

    await deleteTask(deps, x.id);
    await expect(
      moveTask(deps, client, x.id, { bucketId: x.bucketId, afterTaskId: null }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('createTasksFromMessage', () => {
  /** A group with an admin, a client who sent a message with one file, and a To do task. */
  async function setup() {
    const group = await newGroup();
    const admin = await newAdmin();
    await addManager(db, group.id, admin.id);
    const ana = await newClient(group.id, 'Ana');
    const file = await upload(group.id, ana, 'brief.txt');
    const channel = await ensureGroupChannel(db, group.id);
    const m = (
      await sendMessage(deps as AppDeps, {
        channel,
        author: ana,
        data: { body: 'Write A, then B', clientId: randomUUID(), fileIds: [file.id] },
      })
    ).message;
    const existing = await createTask(deps, ana, group.id, { title: 'Existing' });
    return { group, admin, ana, file, m, existing };
  }
  const input = (messageId: string, tasksIn: object[]) =>
    TasksFromMessageSchema.parse({ messageId, tasks: tasksIn });
  const countFiles = async (groupId: string) =>
    (await db.select({ id: files.id }).from(files).where(eq(files.groupId, groupId))).length;
  const todoTitles = async (groupId: string) => {
    const board = await getBoard(db, groupId);
    const todo = board.buckets.find((b) => b.kind === 'todo')!;
    return board.tasks.filter((t) => t.bucketId === todo.id).map((t) => t.title);
  };

  it('creates the cards at the top of To do, in order, linked to the message, with copied files', async () => {
    const { group, admin, ana, file, m } = await setup();
    const [a, b] = await createTasksFromMessage(
      deps,
      admin,
      group.id,
      input(m.id, [
        { title: 'A', messageFileIds: [file.id], assigneeIds: [ana.id] },
        { title: 'B', messageFileIds: [file.id], link: 'https://egrant.sk/b' },
      ]),
      { id: m.id, fileIds: [file.id] },
    );
    expect(await todoTitles(group.id)).toEqual(['A', 'B', 'Existing']);
    expect(a!.link).toBeNull();
    expect(b!.link).toBe('https://egrant.sk/b');
    expect(a!.sourceMessageId).toBe(m.id);
    expect(b!.sourceMessageId).toBe(m.id);
    expect(a!.createdBy).toEqual({ id: admin.id, name: admin.name });
    expect(a!.assignees).toEqual([{ id: ana.id, name: 'Ana' }]);
    expect(await assignedRecipients(a!.id)).toEqual([ana.id]);
    expect(Date.parse(a!.createdAt)).toBeLessThan(Date.parse(b!.createdAt));
    expect(a!.files).toHaveLength(1);
    expect(a!.files[0]!.id).not.toBe(file.id);
    expect(a!.files[0]!.id).not.toBe(b!.files[0]!.id);
    expect(a!.files[0]!.name).toBe('brief.txt');
    const copy = (await getFile(db, a!.files[0]!.id))!;
    expect(copy.uploadedBy).toBe(admin.id);
    expect(copy.attachedAt).not.toBeNull();

    await deleteTask(deps, a!.id);
    expect(await getFile(db, copy.id)).toBeNull();
    expect(await getFile(db, file.id)).not.toBeNull(); // the message keeps its file
  });

  it('createTasksFromMessage refuses a non-pickable assignee', async () => {
    const { group, ana, m } = await setup();
    const outsider = await newAdmin('Nina');
    await expect(
      createTasksFromMessage(
        deps,
        ana,
        group.id,
        input(m.id, [{ title: 'A', assigneeIds: [outsider.id] }]),
        { id: m.id, fileIds: [] },
      ),
    ).rejects.toBeInstanceOf(InvalidAssigneeError);
  });

  it('asks for delivery of the task.assigned events after the commit', async () => {
    const { group, admin, ana, m } = await setup();
    const send = vi.fn(async () => {});
    await createTasksFromMessage(
      { ...deps, jobs: { send } },
      admin,
      group.id,
      input(m.id, [
        { title: 'A', assigneeIds: [ana.id] },
        { title: 'B', assigneeIds: [ana.id, admin.id] },
      ]),
      { id: m.id, fileIds: [] },
    );
    // One request for the events of every card, never the actor's.
    const events = await deps.db
      .select({ id: notificationEvents.id })
      .from(notificationEvents)
      .where(
        and(eq(notificationEvents.userId, ana.id), eq(notificationEvents.kind, 'task.assigned')),
      );
    expect(events).toHaveLength(2);
    expect(send.mock.calls).toHaveLength(1);
    const [name, data] = send.mock.calls[0]! as unknown as [string, { eventIds: string[] }];
    expect(name).toBe(DELIVER_JOB);
    expect(data.eventIds.sort()).toEqual(events.map((e) => e.id).sort());
  });

  it('attaches files uploaded in the review next to the copies', async () => {
    const { group, admin, file, m } = await setup();
    const own = await upload(group.id, admin, 'own.txt');
    const [a] = await createTasksFromMessage(
      deps,
      admin,
      group.id,
      input(m.id, [{ title: 'A', fileIds: [own.id], messageFileIds: [file.id] }]),
      { id: m.id, fileIds: [file.id] },
    );
    expect(a!.files.map((f) => f.name).sort()).toEqual(['brief.txt', 'own.txt']);
    expect(a!.files.map((f) => f.id)).toContain(own.id);
  });

  it('is all or nothing: an invalid assignee on card 2 creates nothing and removes the copies', async () => {
    const { group, admin, file, m } = await setup();
    const other = await newGroup();
    const stranger = await newClient(other.id, 'Stranger');
    const before = await countFiles(group.id);
    await expect(
      createTasksFromMessage(
        deps,
        admin,
        group.id,
        input(m.id, [
          { title: 'A', messageFileIds: [file.id] },
          { title: 'B', messageFileIds: [file.id], assigneeIds: [stranger.id] },
        ]),
        { id: m.id, fileIds: [file.id] },
      ),
    ).rejects.toBeInstanceOf(InvalidAssigneeError);
    expect(await todoTitles(group.id)).toEqual(['Existing']);
    expect(await countFiles(group.id)).toBe(before);
  });

  it('a copy that fails after others succeeded removes the earlier copies', async () => {
    const { group, admin, ana, file, m } = await setup();
    const gone = await upload(group.id, ana, 'gone.txt');
    await db.delete(files).where(eq(files.id, gone.id));
    const before = await countFiles(group.id);
    await expect(
      createTasksFromMessage(
        deps,
        admin,
        group.id,
        input(m.id, [
          { title: 'A', messageFileIds: [file.id] },
          { title: 'B', messageFileIds: [gone.id] },
        ]),
        { id: m.id, fileIds: [file.id, gone.id] },
      ),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
    expect(await todoTitles(group.id)).toEqual(['Existing']);
    expect(await countFiles(group.id)).toBe(before);
  });

  it('a review upload on two cards → InvalidAttachmentError; no tasks and no copies', async () => {
    const { group, admin, file, m } = await setup();
    const own = await upload(group.id, admin, 'own.txt');
    const before = await countFiles(group.id);
    await expect(
      createTasksFromMessage(
        deps,
        admin,
        group.id,
        input(m.id, [
          { title: 'A', fileIds: [own.id], messageFileIds: [file.id] },
          { title: 'B', fileIds: [own.id] },
        ]),
        { id: m.id, fileIds: [file.id] },
      ),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
    expect(await todoTitles(group.id)).toEqual(['Existing']);
    expect(await countFiles(group.id)).toBe(before);
    expect((await getFile(db, own.id))!.attachedAt).toBeNull();
  });

  it('rejects a file that is not on the message, before copying anything', async () => {
    const { group, admin, ana, file, m } = await setup();
    const loose = await upload(group.id, ana, 'loose.txt');
    const before = await countFiles(group.id);
    await expect(
      createTasksFromMessage(
        deps,
        admin,
        group.id,
        input(m.id, [{ title: 'A', messageFileIds: [file.id, loose.id] }]),
        { id: m.id, fileIds: [file.id] },
      ),
    ).rejects.toBeInstanceOf(InvalidAttachmentError);
    expect(await todoTitles(group.id)).toEqual(['Existing']);
    expect(await countFiles(group.id)).toBe(before);
  });
});
