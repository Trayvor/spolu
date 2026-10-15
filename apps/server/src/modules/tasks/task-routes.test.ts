import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  BoardEvents,
  type BoardDto,
  type BoardTaskDeletedEvent,
  type BoardTaskEvent,
  type FileInfo,
  type TaskDetailDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { getFile } from '../files/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';

// `deleteFiles` can be made to fail, to prove the post-commit cleanup never fails a write.
const cleanup = vi.hoisted(() => ({ fail: false }));
vi.mock('../files/service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../files/service.js')>();
  return {
    ...actual,
    deleteFiles: async (...args: Parameters<typeof actual.deleteFiles>) => {
      if (cleanup.fail) throw new Error('cleanup failed');
      return actual.deleteFiles(...args);
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

  it('an active admin and a client of the group are valid assignees', async () => {
    const admin = await adminSession('Abe');
    const g = await newGroup();
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
      sourceMessage: null,
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
});
