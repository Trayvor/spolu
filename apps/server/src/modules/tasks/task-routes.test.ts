import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  BoardEvents,
  ChatEvents,
  type BoardDto,
  type ChatMessageTasksEvent,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type FileInfo,
  type TaskDetailDto,
  type TaskDto,
  type TasksFromMessageResult,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { deleteMessage, getMessage, sendMessage } from '../chat/messages.js';
import { messageAttachments } from '../chat/schema.js';
import { ensureGroupChannel, ensureTaskChannel } from '../chat/service.js';
import { files } from '../files/schema.js';
import { getFile } from '../files/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addManager } from '../groups/managers.js';
import { addAdmin } from '../users/service.js';
import { tasks } from './schema.js';

// `deleteDetachedFiles` can be made to fail, to prove the post-commit cleanup never fails a write.
const cleanup = vi.hoisted(() => ({ fail: false }));
vi.mock('../files/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../files/service.js')>();
  return {
    ...actual,
    deleteDetachedFiles: async (...args: Parameters<typeof actual.deleteDetachedFiles>) => {
      if (cleanup.fail) throw new Error('cleanup failed');
      return actual.deleteDetachedFiles(...args);
    },
  };
});

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('tasks API: tasks', () => {
  let test: TestApp;
  let baseUrl: string;
  const sockets: Socket[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function adminSession(name = 'Task Admin') {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name });
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string, name = 'A Client') {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name, role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, email, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () => createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });
  const board = async (cookie: string, groupId: string) =>
    (await call('GET', `/api/groups/${groupId}/board`, cookie)).json<BoardDto>();
  const upload = async (groupId: string, cookie: string, name = 'notes.txt') =>
    (
      await test.app.inject({
        method: 'POST',
        url: `/api/groups/${groupId}/files`,
        headers: {
          cookie,
          'content-type': 'text/plain',
          'x-file-name': encodeURIComponent(name),
        },
        payload: Buffer.from('hello'),
      })
    ).json<FileInfo>();
  const create = (groupId: string, cookie: string, body: object) =>
    call('POST', `/api/groups/${groupId}/tasks`, cookie, body);

  function listen(cookie: string) {
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    return new Promise<Socket>((resolve) => socket.once('connect', () => resolve(socket)));
  }

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  it('401 without a session', async () => {
    const g = await newGroup();
    expect((await create(g.id, '', { title: 'X' })).statusCode).toBe(401);
    expect((await call('GET', '/api/tasks/x')).statusCode).toBe(401);
    expect((await call('PATCH', '/api/tasks/x', undefined, {})).statusCode).toBe(401);
    expect((await call('DELETE', '/api/tasks/x')).statusCode).toBe(401);
    expect((await call('POST', '/api/tasks/x/move', undefined, {})).statusCode).toBe(401);
  });

  it('a client creates a task with only a title → 201, in To do, at the end, creator = client', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id, 'Cleo');
    const first = await create(g.id, client.cookie, { title: 'First' });
    const res = await create(g.id, client.cookie, { title: 'Second' });
    expect(first.statusCode).toBe(201);
    expect(res.statusCode).toBe(201);
    const task = res.json<TaskDetailDto>();
    const b = await board(client.cookie, g.id);
    const todo = b.buckets.find((x) => x.kind === 'todo')!;
    expect(task).toMatchObject({
      bucketId: todo.id,
      createdBy: { id: client.id, name: 'Cleo' },
      completedAt: null,
    });
    expect(b.tasks.filter((t) => t.bucketId === todo.id).map((t) => t.title)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('create with the bucketId of Completed sets completedAt', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const done = (await board(cookie, g.id)).buckets.find((b) => b.kind === 'done')!;
    const res = await create(g.id, cookie, { title: 'Done', bucketId: done.id });
    expect(res.statusCode).toBe(201);
    expect(res.json<TaskDetailDto>().completedAt).not.toBeNull();
  });

  it('create with a bucketId of another group → 404', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const other = await newGroup();
    const foreign = (await board(cookie, other.id)).buckets[0]!;
    const res = await create(g.id, cookie, { title: 'X', bucketId: foreign.id });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('an invalid body → 400 validation_failed; more than 20 files too', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    expect((await create(g.id, client.cookie, { title: '  ' })).json()).toEqual({
      error: 'validation_failed',
    });
    const files = Array.from({ length: 21 }, () => randomUUID());
    const res = await create(g.id, client.cookie, { title: 'Many', fileIds: files });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed' });
  });

  it('an assignee from another group → 400 invalid_assignee', async () => {
    const g = await newGroup();
    const other = await newGroup();
    const client = await clientIn(g.id);
    const stranger = await clientIn(other.id);
    const res = await create(g.id, client.cookie, { title: 'X', assigneeIds: [stranger.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_assignee' });
  });

  it('11 assignees → 400 invalid_assignee', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const ids = Array.from({ length: 11 }, () => randomUUID());
    const res = await create(g.id, client.cookie, { title: 'X', assigneeIds: ids });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_assignee' });
  });

  it('POST with a non-manager assignee answers 400 invalid_assignee', async () => {
    const admin = await adminSession('Nina');
    const g = await newGroup();
    const client = await clientIn(g.id);
    const res = await create(g.id, client.cookie, { title: 'X', assigneeIds: [admin.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_assignee' });
  });

  it('a manager and a client of the group are valid assignees', async () => {
    const admin = await adminSession('Abe');
    const g = await newGroup();
    await addManager(test.deps.db, g.id, admin.id);
    const client = await clientIn(g.id, 'Bea');
    const res = await create(g.id, client.cookie, {
      title: 'X',
      assigneeIds: [admin.id, client.id],
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<TaskDetailDto>().assignees).toEqual([
      { id: admin.id, name: 'Abe' },
      { id: client.id, name: 'Bea' },
    ]);
  });

  it('create with a file uploaded by someone else → 400 invalid_attachment', async () => {
    const admin = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const theirs = await upload(g.id, admin.cookie);
    const res = await create(g.id, client.cookie, { title: 'X', fileIds: [theirs.id] });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_attachment' });
  });

  it('GET /tasks/:id returns description and files (FileInfo)', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const file = await upload(g.id, client.cookie, 'plan.txt');
    const created = (
      await create(g.id, client.cookie, {
        title: 'X',
        description: 'Details',
        fileIds: [file.id],
      })
    ).json<TaskDetailDto>();
    const res = await call('GET', `/api/tasks/${created.id}`, client.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json<TaskDetailDto>()).toMatchObject({
      id: created.id,
      description: 'Details',
      files: [file],
      fileCount: 1,
      upcomingReminders: 0,
      sourceMessage: null,
    });
  });

  describe('link', () => {
    it('create stores a trimmed http(s) link on the detail and the board card; empty is null', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      const res = await create(g.id, client.cookie, {
        title: 'Linked',
        link: '  https://egrant.sk/projekt/42  ',
      });
      expect(res.statusCode).toBe(201);
      const task = res.json<TaskDetailDto>();
      expect(task.link).toBe('https://egrant.sk/projekt/42');
      const card = (await board(client.cookie, g.id)).tasks.find((c) => c.id === task.id);
      expect(card?.link).toBe('https://egrant.sk/projekt/42');

      const empty = (
        await create(g.id, client.cookie, { title: 'No link', link: '' })
      ).json<TaskDetailDto>();
      expect(empty.link).toBeNull();
      const omitted = (
        await create(g.id, client.cookie, { title: 'Omitted' })
      ).json<TaskDetailDto>();
      expect(omitted.link).toBeNull();
    });

    it('a link that is not an http(s) URL → 400 invalid_url, on create and on edit', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      for (const link of [
        'javascript:alert(1)',
        'ftp://files.example.com/a',
        'egrant.sk',
        `https://e.sk/${'a'.repeat(2048)}`,
      ]) {
        const res = await create(g.id, client.cookie, { title: 'Bad', link });
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_url' });
      }
      const task = (await create(g.id, client.cookie, { title: 'A' })).json<TaskDetailDto>();
      const bad = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
        link: 'javascript:alert(1)',
        updatedAt: task.updatedAt,
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({ error: 'invalid_url' });
      const now = (await call('GET', `/api/tasks/${task.id}`, client.cookie)).json<TaskDetailDto>();
      expect(now.link).toBeNull();
    });

    it('whoever may edit the task sets and clears the link; the board event carries it', async () => {
      const admin = await adminSession('Link Admin');
      const g = await newGroup();
      const client = await clientIn(g.id);
      const task = (await create(g.id, client.cookie, { title: 'A' })).json<TaskDetailDto>();
      const socket = await listen(client.cookie);

      const pushed = new Promise<BoardTaskEvent>((resolve) =>
        socket.once(BoardEvents.task, resolve),
      );
      const set = await call('PATCH', `/api/tasks/${task.id}`, admin.cookie, {
        link: 'http://example.com/ticket?id=7',
        updatedAt: task.updatedAt,
      });
      expect(set.statusCode).toBe(200);
      const withLink = set.json<TaskDetailDto>();
      expect(withLink).toMatchObject({ link: 'http://example.com/ticket?id=7', title: 'A' });
      expect((await pushed).task.link).toBe('http://example.com/ticket?id=7');

      // Another field only: the link stays.
      const titled = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
        title: 'B',
        updatedAt: withLink.updatedAt,
      });
      expect(titled.json<TaskDetailDto>().link).toBe('http://example.com/ticket?id=7');

      const cleared = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
        link: '',
        updatedAt: titled.json<TaskDetailDto>().updatedAt,
      });
      expect(cleared.statusCode).toBe(200);
      expect(cleared.json<TaskDetailDto>().link).toBeNull();
    });

    it('someone outside the group cannot set the link (404)', async () => {
      const g = await newGroup();
      const other = await newGroup();
      const client = await clientIn(g.id);
      const stranger = await clientIn(other.id);
      const task = (await create(g.id, client.cookie, { title: 'A' })).json<TaskDetailDto>();
      const res = await call('PATCH', `/api/tasks/${task.id}`, stranger.cookie, {
        link: 'https://evil.example.com',
        updatedAt: task.updatedAt,
      });
      expect(res.statusCode).toBe(404);
      const now = (await call('GET', `/api/tasks/${task.id}`, client.cookie)).json<TaskDetailDto>();
      expect(now.link).toBeNull();
    });
  });

  it('PATCH twice with the returned updatedAt succeeds both times', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const task = (await create(g.id, client.cookie, { title: 'A' })).json<TaskDetailDto>();
    const one = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
      title: 'B',
      updatedAt: task.updatedAt,
    });
    expect(one.statusCode).toBe(200);
    const two = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
      title: 'C',
      updatedAt: one.json<TaskDetailDto>().updatedAt,
    });
    expect(two.statusCode).toBe(200);
    expect(two.json<TaskDetailDto>().title).toBe('C');
  });

  it('PATCH with an older updatedAt → 409 task_changed and nothing changes', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const task = (await create(g.id, client.cookie, { title: 'A' })).json<TaskDetailDto>();
    await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
      title: 'B',
      updatedAt: task.updatedAt,
    });
    const stale = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
      title: 'Stale',
      urgent: true,
      updatedAt: task.updatedAt,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'task_changed' });
    const now = (await call('GET', `/api/tasks/${task.id}`, client.cookie)).json<TaskDetailDto>();
    expect(now).toMatchObject({ title: 'B', urgent: false });
  });

  it('PATCH { title } keeps assignees, files and urgent; urgent can be set and cleared', async () => {
    const admin = await adminSession();
    const g = await newGroup();
    await addManager(test.deps.db, g.id, admin.id);
    const client = await clientIn(g.id);
    const file = await upload(g.id, client.cookie);
    const task = (
      await create(g.id, client.cookie, {
        title: 'A',
        assigneeIds: [admin.id],
        fileIds: [file.id],
        urgent: true,
      })
    ).json<TaskDetailDto>();
    expect(task.urgent).toBe(true);
    const edited = (
      await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
        title: 'B',
        updatedAt: task.updatedAt,
      })
    ).json<TaskDetailDto>();
    expect(edited).toMatchObject({ title: 'B', urgent: true, fileCount: 1 });
    expect(edited.assignees.map((a) => a.id)).toEqual([admin.id]);
    expect(edited.files.map((f) => f.id)).toEqual([file.id]);
    const cleared = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
      urgent: false,
      updatedAt: edited.updatedAt,
    });
    expect(cleared.json<TaskDetailDto>().urgent).toBe(false);
  });

  it("a client edits someone else's task → 200", async () => {
    const admin = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const task = (await create(g.id, admin.cookie, { title: 'Admin task' })).json<TaskDetailDto>();
    const res = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
      description: 'Client notes',
      updatedAt: task.updatedAt,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<TaskDetailDto>().description).toBe('Client notes');
  });

  it('a removed assignee stays and does not block edits', async () => {
    const admin = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id, 'Leaving');
    const task = (
      await create(g.id, admin.cookie, { title: 'A', assigneeIds: [client.id] })
    ).json<TaskDetailDto>();
    const removed = await call('DELETE', `/api/groups/${g.id}/members/${client.id}`, admin.cookie);
    expect(removed.statusCode).toBe(204);
    const res = await call('PATCH', `/api/tasks/${task.id}`, admin.cookie, {
      title: 'B',
      assigneeIds: [client.id],
      updatedAt: task.updatedAt,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<TaskDetailDto>().assignees.map((a) => a.id)).toEqual([client.id]);
  });

  it('PATCH removing a file unlinks it and deletes it from storage', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const file = await upload(g.id, client.cookie);
    const task = (
      await create(g.id, client.cookie, { title: 'A', fileIds: [file.id] })
    ).json<TaskDetailDto>();
    const key = (await getFile(test.deps.db, file.id))!.storageKey;
    const res = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
      fileIds: [],
      updatedAt: task.updatedAt,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<TaskDetailDto>()).toMatchObject({ files: [], fileCount: 0 });
    expect(await getFile(test.deps.db, file.id)).toBeNull();
    expect(await test.deps.storage.exists(key)).toBe(false);
  });

  it("client deletes own task → 204, someone else's → 403; admin deletes any → 204; files gone", async () => {
    const admin = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const file = await upload(g.id, client.cookie);
    const own = (
      await create(g.id, client.cookie, { title: 'Own', fileIds: [file.id] })
    ).json<TaskDetailDto>();
    const theirs = (await create(g.id, admin.cookie, { title: 'Theirs' })).json<TaskDetailDto>();
    const another = (await create(g.id, client.cookie, { title: 'Another' })).json<TaskDetailDto>();
    const key = (await getFile(test.deps.db, file.id))!.storageKey;

    expect((await call('DELETE', `/api/tasks/${own.id}`, client.cookie)).statusCode).toBe(204);
    expect(await test.deps.storage.exists(key)).toBe(false);
    expect((await call('GET', `/api/tasks/${own.id}`, client.cookie)).statusCode).toBe(404);
    const refused = await call('DELETE', `/api/tasks/${theirs.id}`, client.cookie);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'forbidden' });
    expect((await call('DELETE', `/api/tasks/${another.id}`, admin.cookie)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/tasks/${theirs.id}`, admin.cookie)).statusCode).toBe(204);
  });

  it("another group's client gets 404 on GET, PATCH, DELETE and create", async () => {
    const g = await newGroup();
    const other = await newGroup();
    const client = await clientIn(g.id);
    const stranger = await clientIn(other.id);
    const task = (await create(g.id, client.cookie, { title: 'A' })).json<TaskDetailDto>();
    expect((await call('GET', `/api/tasks/${task.id}`, stranger.cookie)).statusCode).toBe(404);
    expect(
      (
        await call('PATCH', `/api/tasks/${task.id}`, stranger.cookie, {
          title: 'X',
          updatedAt: task.updatedAt,
        })
      ).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/api/tasks/${task.id}`, stranger.cookie)).statusCode).toBe(404);
    expect((await create(g.id, stranger.cookie, { title: 'X' })).statusCode).toBe(404);
    const { cookie } = await adminSession();
    expect((await call('GET', '/api/tasks/nope', cookie)).statusCode).toBe(404);
    expect((await create('nope', cookie, { title: 'X' })).statusCode).toBe(404);
  });

  it('a client socket receives board:task with actor after PATCH and board:task_deleted after DELETE', async () => {
    const admin = await adminSession('Live Admin');
    const g = await newGroup();
    const client = await clientIn(g.id);
    const task = (await create(g.id, admin.cookie, { title: 'A' })).json<TaskDetailDto>();
    const socket = await listen(client.cookie);

    const updated = new Promise<BoardTaskEvent>((resolve) =>
      socket.once(BoardEvents.task, resolve),
    );
    await call('PATCH', `/api/tasks/${task.id}`, admin.cookie, {
      title: 'Live',
      updatedAt: task.updatedAt,
    });
    const event = await updated;
    expect(event.actor).toEqual({ id: admin.id, name: 'Live Admin' });
    expect(event.task).toMatchObject({ id: task.id, groupId: g.id, title: 'Live' });
    expect(event.task).not.toHaveProperty('description');

    const deleted = new Promise<BoardTaskDeletedEvent>((resolve) =>
      socket.once(BoardEvents.taskDeleted, resolve),
    );
    await call('DELETE', `/api/tasks/${task.id}`, admin.cookie);
    expect(await deleted).toEqual({ groupId: g.id, taskId: task.id });
  });

  const move = (taskId: string, cookie: string, body: object) =>
    call('POST', `/api/tasks/${taskId}/move`, cookie, body);

  it('renaming, moving or deleting a task made from a message pushes chat:message_tasks', async () => {
    const admin = await adminSession('Link Admin');
    const g = await newGroup();
    const client = await clientIn(g.id, 'Linda');
    const channel = await ensureGroupChannel(test.deps.db, g.id);
    const root = await sendMessage(test.deps, {
      channel,
      author: { id: client.id, email: client.email, name: 'Linda', role: 'client' },
      data: { body: 'Do the report', clientId: randomUUID() },
    });
    const task = (await create(g.id, admin.cookie, { title: 'Report' })).json<TaskDetailDto>();
    const plain = (await create(g.id, admin.cookie, { title: 'Plain' })).json<TaskDetailDto>();
    await test.deps.db
      .update(tasks)
      .set({ sourceMessageId: root.message.id })
      .where(eq(tasks.id, task.id));
    const socket = await listen(client.cookie);
    const received: ChatMessageTasksEvent[] = [];
    socket.on(ChatEvents.messageTasks, (e: ChatMessageTasksEvent) => received.push(e));
    const next = () =>
      new Promise<ChatMessageTasksEvent>((resolve) =>
        socket.once(ChatEvents.messageTasks, resolve),
      );
    const base = {
      groupId: g.id,
      channelId: channel.id,
      messageId: root.message.id,
      parentId: null,
    };

    let pushed = next();
    await call('PATCH', `/api/tasks/${task.id}`, admin.cookie, {
      title: 'Report v2',
      updatedAt: task.updatedAt,
    });
    expect(await pushed).toEqual({
      ...base,
      tasks: [{ id: task.id, title: 'Report v2', completed: false }],
    });

    const done = (await board(admin.cookie, g.id)).buckets.find((b) => b.kind === 'done')!;
    pushed = next();
    await move(task.id, admin.cookie, { bucketId: done.id, afterTaskId: null });
    expect((await pushed).tasks).toEqual([{ id: task.id, title: 'Report v2', completed: true }]);

    // Tasks without a source message push nothing.
    await call('PATCH', `/api/tasks/${plain.id}`, admin.cookie, {
      title: 'Plain v2',
      updatedAt: plain.updatedAt,
    });
    await call('DELETE', `/api/tasks/${plain.id}`, admin.cookie);

    pushed = next();
    await call('DELETE', `/api/tasks/${task.id}`, admin.cookie);
    expect(await pushed).toEqual({ ...base, tasks: [] });
    expect(received).toHaveLength(3);
  });

  it('a failing file cleanup after the commit still answers 200/204 and emits the events', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const keep = await upload(g.id, client.cookie);
    const drop = await upload(g.id, client.cookie);
    const task = (
      await create(g.id, client.cookie, { title: 'A', fileIds: [keep.id, drop.id] })
    ).json<TaskDetailDto>();
    const socket = await listen(client.cookie);
    cleanup.fail = true;
    try {
      const updated = new Promise<BoardTaskEvent>((resolve) =>
        socket.once(BoardEvents.task, resolve),
      );
      const edited = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
        fileIds: [keep.id],
        updatedAt: task.updatedAt,
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json<TaskDetailDto>().files.map((f) => f.id)).toEqual([keep.id]);
      expect((await updated).task.fileCount).toBe(1);
      // The cleanup really failed: the removed file's row is still there.
      expect(await getFile(test.deps.db, drop.id)).not.toBeNull();

      const deleted = new Promise<BoardTaskDeletedEvent>((resolve) =>
        socket.once(BoardEvents.taskDeleted, resolve),
      );
      expect((await call('DELETE', `/api/tasks/${task.id}`, client.cookie)).statusCode).toBe(204);
      expect(await deleted).toEqual({ groupId: g.id, taskId: task.id });
    } finally {
      cleanup.fail = false;
    }
  });

  it("client moves a task (200) and others see board:task; another group's client → 404", async () => {
    const admin = await adminSession('Mover Admin');
    const g = await newGroup();
    const client = await clientIn(g.id, 'Cleo');
    const stranger = await clientIn((await newGroup()).id);
    const task = (await create(g.id, admin.cookie, { title: 'A' })).json<TaskDetailDto>();
    const review = (await board(client.cookie, g.id)).buckets.find(
      (b) => b.kind === 'egrant_review',
    )!;
    const watcher = await clientIn(g.id, 'Watcher');
    const socket = await listen(watcher.cookie);
    const pushed = new Promise<BoardTaskEvent>((resolve) => socket.once(BoardEvents.task, resolve));

    expect(
      (await move(task.id, stranger.cookie, { bucketId: review.id, afterTaskId: null })).statusCode,
    ).toBe(404);
    const res = await move(task.id, client.cookie, { bucketId: review.id, afterTaskId: null });
    expect(res.statusCode).toBe(200);
    const moved = res.json<TaskDto>();
    expect(moved).toMatchObject({ id: task.id, bucketId: review.id, updatedAt: task.updatedAt });
    expect(moved).not.toHaveProperty('description');
    const event = await pushed;
    expect(event.actor).toEqual({ id: client.id, name: 'Cleo' });
    expect(event.task).toEqual(moved);
  });

  it('done circle: a client marks a task done (top of Completed) and not done (top of To do)', async () => {
    const admin = await adminSession('Done Admin');
    const g = await newGroup();
    const client = await clientIn(g.id, 'Dora');
    const task = (await create(g.id, admin.cookie, { title: 'Finish' })).json<TaskDetailDto>();
    const other = (await create(g.id, admin.cookie, { title: 'Other' })).json<TaskDetailDto>();
    const buckets = (await board(client.cookie, g.id)).buckets;
    const todo = buckets.find((b) => b.kind === 'todo')!;
    const done = buckets.find((b) => b.kind === 'done')!;
    // Something already in Completed: the done task goes above it.
    await move(other.id, admin.cookie, { bucketId: done.id, afterTaskId: null });
    const watcher = await clientIn(g.id, 'Watcher');
    const socket = await listen(watcher.cookie);
    const pushed = new Promise<BoardTaskEvent>((resolve) => socket.once(BoardEvents.task, resolve));

    const checked = await move(task.id, client.cookie, { bucketId: done.id, afterTaskId: null });
    expect(checked.statusCode).toBe(200);
    expect(checked.json<TaskDto>().completedAt).not.toBeNull();
    expect((await pushed).task.bucketId).toBe(done.id);
    let tasks = (await board(client.cookie, g.id)).tasks.filter((t) => t.bucketId === done.id);
    expect(tasks.map((t) => t.id)).toEqual([task.id, other.id]);

    const unchecked = await move(task.id, client.cookie, { bucketId: todo.id, afterTaskId: null });
    expect(unchecked.json<TaskDto>()).toMatchObject({ bucketId: todo.id, completedAt: null });
    tasks = (await board(client.cookie, g.id)).tasks.filter((t) => t.bucketId === todo.id);
    expect(tasks[0]!.id).toBe(task.id);

    const events = await test.deps.db
      .select({ userId: notificationEvents.userId, payload: notificationEvents.payload })
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.kind, 'task.moved'),
          sql`${notificationEvents.payload}->>'taskId' = ${task.id}`,
        ),
      );
    expect(events.map((e) => e.userId)).toEqual([admin.id, admin.id]);
    expect(
      events.map((e) => (e.payload as { toBucket: { kind: string } }).toBucket.kind).sort(),
    ).toEqual(['done', 'todo']);
  });

  it('move: an invalid body or an afterTaskId from another bucket → 400; an unknown task → 404', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const a = (await create(g.id, client.cookie, { title: 'A' })).json<TaskDetailDto>();
    const b = (await create(g.id, client.cookie, { title: 'B' })).json<TaskDetailDto>();
    const review = (await board(client.cookie, g.id)).buckets.find(
      (x) => x.kind === 'egrant_review',
    )!;
    expect((await move(a.id, client.cookie, { bucketId: review.id })).json()).toEqual({
      error: 'validation_failed',
    });
    const wrong = await move(a.id, client.cookie, { bucketId: review.id, afterTaskId: b.id });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json()).toEqual({ error: 'validation_failed' });
    expect(
      (await move(randomUUID(), client.cookie, { bucketId: review.id, afterTaskId: null }))
        .statusCode,
    ).toBe(404);
  });
  /** A group with a client who sent a message carrying one file, in the group chat. */
  async function messageSetup(name = 'Mira') {
    const g = await newGroup();
    const client = await clientIn(g.id, name);
    const file = await upload(g.id, client.cookie, 'brief.txt');
    const channel = await ensureGroupChannel(test.deps.db, g.id);
    const author = { id: client.id, email: client.email, name, role: 'client' as const };
    const { message } = await sendMessage(test.deps, {
      channel,
      author,
      data: { body: 'Do A and B', clientId: randomUUID(), fileIds: [file.id] },
    });
    return { g, client, file, channel, author, message };
  }
  const fromMessage = (groupId: string, cookie: string, body: object) =>
    call('POST', `/api/groups/${groupId}/tasks/from-message`, cookie, body);
  const countFiles = async (groupId: string) =>
    (await test.deps.db.select({ id: files.id }).from(files).where(eq(files.groupId, groupId)))
      .length;

  it('POST from-message: 201, board:task per card and one chat:message_tasks', async () => {
    const admin = await adminSession('Split Admin');
    const { g, client, file, channel, message } = await messageSetup();
    await create(g.id, client.cookie, { title: 'Existing' });
    const socket = await listen(client.cookie);
    const boardEvents: BoardTaskEvent[] = [];
    const linkEvents: ChatMessageTasksEvent[] = [];
    socket.on(BoardEvents.task, (e: BoardTaskEvent) => boardEvents.push(e));
    const linked = new Promise<ChatMessageTasksEvent>((resolve) =>
      socket.on(ChatEvents.messageTasks, (e: ChatMessageTasksEvent) => {
        linkEvents.push(e);
        resolve(e);
      }),
    );

    const res = await fromMessage(g.id, admin.cookie, {
      messageId: message.id,
      tasks: [
        { title: 'A', messageFileIds: [file.id], assigneeIds: [client.id] },
        { title: 'B', urgent: true },
      ],
    });
    expect(res.statusCode).toBe(201);
    const { tasks: created } = res.json<TasksFromMessageResult>();
    expect(created.map((t) => t.title)).toEqual(['A', 'B']);
    expect(created[0]).toMatchObject({ sourceMessageId: message.id, urgent: false });
    expect(created[0]!.sourceMessage).toMatchObject({ id: message.id, channelId: channel.id });
    expect(created[0]!.files).toHaveLength(1);
    expect(created[0]!.files[0]!.id).not.toBe(file.id);

    const event = await linked;
    expect(event).toEqual({
      groupId: g.id,
      channelId: channel.id,
      messageId: message.id,
      parentId: null,
      tasks: created.map((t) => ({ id: t.id, title: t.title, completed: false })),
    });
    const b = await board(client.cookie, g.id);
    const todo = b.buckets.find((x) => x.kind === 'todo')!;
    expect(b.tasks.filter((t) => t.bucketId === todo.id).map((t) => t.title)).toEqual([
      'A',
      'B',
      'Existing',
    ]);
    // board:task is emitted before chat:message_tasks, so both have arrived by now.
    expect(boardEvents.map((e) => e.task.title)).toEqual(['A', 'B']);
    expect(boardEvents[0]!.actor).toEqual({ id: admin.id, name: 'Split Admin' });
    expect(linkEvents).toHaveLength(1);

    // The message lists its tasks too.
    const page = await call('GET', `/api/channels/${channel.id}/messages`, client.cookie);
    const listed = page
      .json<{ messages: { id: string; tasks: { id: string }[] }[] }>()
      .messages.find((m) => m.id === message.id)!;
    expect(listed.tasks.map((t) => t.id)).toEqual(created.map((t) => t.id));
  });

  it('a message in a task chat of the same group is a valid source', async () => {
    const { g, client, author } = await messageSetup();
    const host = (await create(g.id, client.cookie, { title: 'Host' })).json<TaskDetailDto>();
    const channel = await ensureTaskChannel(test.deps.db, host);
    const { message } = await sendMessage(test.deps, {
      channel,
      author,
      data: { body: 'Inside', clientId: randomUUID() },
    });
    const res = await fromMessage(g.id, client.cookie, {
      messageId: message.id,
      tasks: [{ title: 'From the task chat' }],
    });
    expect(res.statusCode).toBe(201);
  });

  it("404 for a message of another group, a deleted message, an unknown one, or another group's client", async () => {
    const admin = await adminSession();
    const a = await messageSetup('Ann');
    const b = await messageSetup('Bob');
    const filesA = await countFiles(a.g.id);
    const filesB = await countFiles(b.g.id);
    const body = (messageId: string) => ({
      messageId,
      tasks: [{ title: 'X', messageFileIds: [a.file.id] }],
    });

    // A message from group A, tasks for group B: 404 and nothing is created anywhere.
    expect((await fromMessage(b.g.id, admin.cookie, body(a.message.id))).statusCode).toBe(404);
    // Group B's client may not read group A's message nor open its board.
    expect((await fromMessage(b.g.id, b.client.cookie, body(a.message.id))).statusCode).toBe(404);
    expect((await fromMessage(a.g.id, b.client.cookie, body(a.message.id))).statusCode).toBe(404);
    expect((await fromMessage(a.g.id, admin.cookie, body(randomUUID()))).statusCode).toBe(404);
    expect((await board(admin.cookie, a.g.id)).tasks).toHaveLength(0);
    expect((await board(admin.cookie, b.g.id)).tasks).toHaveLength(0);
    expect(await countFiles(a.g.id)).toBe(filesA);
    expect(await countFiles(b.g.id)).toBe(filesB);

    await deleteMessage(test.deps, {
      channel: a.channel,
      message: (await getMessage(test.deps.db, a.message.id))!,
    });
    expect((await fromMessage(a.g.id, admin.cookie, body(a.message.id))).statusCode).toBe(404);
    expect((await board(admin.cookie, a.g.id)).tasks).toHaveLength(0);
  });

  it('400 for an invalid body: no cards, more than 10, a bad message id, too many files', async () => {
    const { g, client, file, message } = await messageSetup();
    const send = (body: object) => fromMessage(g.id, client.cookie, body);
    expect((await send({ messageId: message.id, tasks: [] })).statusCode).toBe(400);
    const eleven = Array.from({ length: 11 }, (_, i) => ({ title: `T${i}` }));
    expect((await send({ messageId: message.id, tasks: eleven })).statusCode).toBe(400);
    expect((await send({ messageId: 'bad id!', tasks: [{ title: 'X' }] })).statusCode).toBe(400);
    const many = Array.from({ length: 11 }, () => randomUUID());
    const res = await send({
      messageId: message.id,
      tasks: [{ title: 'X', fileIds: many, messageFileIds: [file.id, ...many.slice(1)] }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed' });
    const crowd = Array.from({ length: 11 }, () => randomUUID());
    const tooMany = await send({
      messageId: message.id,
      tasks: [{ title: 'X', assigneeIds: crowd }],
    });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toEqual({ error: 'invalid_assignee' });
    const badLink = await send({
      messageId: message.id,
      tasks: [{ title: 'X', link: 'javascript:alert(1)' }],
    });
    expect(badLink.statusCode).toBe(400);
    expect(badLink.json()).toEqual({ error: 'invalid_url' });
  });

  it('400 invalid_attachment when the message lost the file since the proposal', async () => {
    const { g, client, file, message } = await messageSetup();
    await test.deps.db
      .delete(messageAttachments)
      .where(
        and(eq(messageAttachments.messageId, message.id), eq(messageAttachments.fileId, file.id)),
      );
    const before = await countFiles(g.id);
    const res = await fromMessage(g.id, client.cookie, {
      messageId: message.id,
      tasks: [{ title: 'A' }, { title: 'B', messageFileIds: [file.id] }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_attachment' });
    expect((await board(client.cookie, g.id)).tasks).toHaveLength(0);
    expect(await countFiles(g.id)).toBe(before);
  });

  it('400 invalid_assignee for an assignee from another group; nothing is created', async () => {
    const { g, client, file, message } = await messageSetup();
    const other = await messageSetup('Otto');
    const before = await countFiles(g.id);
    const res = await fromMessage(g.id, client.cookie, {
      messageId: message.id,
      tasks: [
        { title: 'A', messageFileIds: [file.id] },
        { title: 'B', assigneeIds: [other.client.id] },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_assignee' });
    expect((await board(client.cookie, g.id)).tasks).toHaveLength(0);
    expect(await countFiles(g.id)).toBe(before);
  });
});
