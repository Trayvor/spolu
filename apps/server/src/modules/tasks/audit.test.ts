import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BoardDto, TaskDetailDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpToken } from '../../../test/mcp.js';
import { auditRowsOf, auditRowsOfMany } from '../audit/test-helpers.js';
import { sendMessage } from '../chat/messages.js';
import { ensureGroupChannel } from '../chat/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('tasks and buckets: audit rows', () => {
  let test: TestApp;
  let admin: { id: string; cookie: string; email: string };
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp();
    const email = newEmail();
    const row = await addAdmin(test.deps.db, { email, name: 'Jana Nováková' });
    admins.push(row.id);
    admin = { id: row.id, email, cookie: await loginAs(test.app, email) };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const newGroup = () => createGroup(db(), { name: 'Mesto Senica', egrantUrl: newUrl() });
  const board = async (groupId: string) =>
    (await call('GET', `/api/groups/${groupId}/board`, admin.cookie)).json<BoardDto>();
  const bucketOf = async (groupId: string, kind: string) =>
    (await board(groupId)).buckets.find((b) => b.kind === kind)!;
  const create = async (groupId: string, body: object, cookie = admin.cookie) => {
    const res = await call('POST', `/api/groups/${groupId}/tasks`, cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<TaskDetailDto>();
  };
  const patch = (task: TaskDetailDto, body: object, cookie = admin.cookie) =>
    call('PATCH', `/api/tasks/${task.id}`, cookie, { ...body, updatedAt: task.updatedAt });
  const move = (taskId: string, bucketId: string) =>
    call('POST', `/api/tasks/${taskId}/move`, admin.cookie, { bucketId, afterTaskId: null });

  it('creating a task records task.created with title, bucket and assignees', async () => {
    const group = await newGroup();
    const task = await create(group.id, {
      title: 'Pripraviť rozpočet',
      description: 'Tajný obsah popisu 7x9',
      assigneeIds: [admin.id],
    });
    const rows = await auditRowsOf(db(), task.id);
    expect(rows).toHaveLength(1);
    const todo = await bucketOf(group.id, 'todo');
    expect(rows[0]).toMatchObject({
      entityType: 'task',
      action: 'created',
      entityLabel: 'Pripraviť rozpočet',
      groupId: group.id,
      actorKind: 'user',
      actorUserId: admin.id,
      changes: {
        title: { to: 'Pripraviť rozpočet' },
        description: { changed: true },
        bucket: { to: { id: todo.id, label: 'todo' } },
        assignees: { added: [{ id: admin.id, label: 'Jana Nováková' }], removed: [] },
      },
    });
    expect(JSON.stringify(rows[0]!.changes)).not.toContain('Tajný obsah');
  });

  it('editing the due date records from and to; the description records changed, never its text; no change records nothing', async () => {
    const group = await newGroup();
    let task = await create(group.id, { title: 'Termín', dueDate: '2026-10-20' });
    let res = await patch(task, { dueDate: '2026-10-24', description: 'Iný tajný text 5q' });
    expect(res.statusCode).toBe(200);
    task = res.json<TaskDetailDto>();
    res = await patch(task, { title: 'Termín' }); // unchanged
    expect(res.statusCode).toBe(200);
    const rows = await auditRowsOf(db(), task.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'updated']);
    expect(rows[1]!.changes).toEqual({
      dueDate: { from: '2026-10-20', to: '2026-10-24' },
      description: { changed: true },
    });
    expect(JSON.stringify(rows)).not.toContain('Iný tajný text');
  });

  it('a stale updatedAt (TaskChangedError) records nothing', async () => {
    const group = await newGroup();
    const task = await create(group.id, { title: 'Stale' });
    expect((await patch(task, { title: 'First' })).statusCode).toBe(200);
    expect((await patch(task, { title: 'Second' })).statusCode).toBe(409);
    const rows = await auditRowsOf(db(), task.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'updated']);
  });

  it('moving to another bucket records task.moved; into Completed completed, back reopened; a reorder records nothing', async () => {
    const group = await newGroup();
    const task = await create(group.id, { title: 'Presun' });
    const other = await create(group.id, { title: 'Iná' });
    const todo = await bucketOf(group.id, 'todo');
    const doing = (await board(group.id)).buckets.find(
      (b) => b.kind !== 'todo' && b.kind !== 'done',
    )!;
    const done = await bucketOf(group.id, 'done');
    // A reorder in To do.
    await call('POST', `/api/tasks/${task.id}/move`, admin.cookie, {
      bucketId: todo.id,
      afterTaskId: other.id,
    });
    await move(task.id, doing.id);
    await move(task.id, done.id);
    await move(task.id, todo.id);
    const rows = await auditRowsOf(db(), task.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'moved', 'completed', 'reopened']);
    expect(rows[1]!.changes).toEqual({
      bucket: { from: { id: todo.id, label: 'todo' }, to: { id: doing.id, label: doing.kind } },
    });
  });

  it('deleting records task.deleted with the title', async () => {
    const group = await newGroup();
    const task = await create(group.id, { title: 'Zmazať', description: 'obsah' });
    expect((await call('DELETE', `/api/tasks/${task.id}`, admin.cookie)).statusCode).toBe(204);
    const rows = await auditRowsOf(db(), task.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'deleted']);
    expect(rows[1]).toMatchObject({ entityLabel: 'Zmazať', groupId: group.id });
    expect(rows[1]!.changes).toMatchObject({ title: { from: 'Zmazať' } });
    expect(rows[1]!.changes).not.toHaveProperty('description');
  });

  it("a client's edit records the client as author", async () => {
    const group = await newGroup();
    const email = newEmail();
    const clientId = randomUUID();
    await db()
      .insert(user)
      .values({ id: clientId, email, name: 'Klientka', role: 'client', emailVerified: true });
    await addMember(db(), group.id, clientId);
    const cookie = await loginAs(test.app, email);
    const task = await create(group.id, { title: 'Klientova' }, cookie);
    expect((await patch(task, { title: 'Klientova 2' }, cookie)).statusCode).toBe(200);
    const rows = await auditRowsOf(db(), task.id);
    expect(rows.map((r) => [r.action, r.actorUserId])).toEqual([
      ['created', clientId],
      ['updated', clientId],
    ]);
  });

  it('the cards of a message record one row per created task in one insert', async () => {
    const group = await newGroup();
    const channel = await ensureGroupChannel(db(), group.id);
    const { message } = await sendMessage(test.deps, {
      channel,
      author: {
        id: admin.id,
        email: admin.email,
        name: 'Jana Nováková',
        role: 'admin',
        finance: false,
      },
      data: { body: 'Urobme dve veci', clientId: randomUUID() },
    });
    const res = await call('POST', `/api/groups/${group.id}/tasks/from-message`, admin.cookie, {
      messageId: message.id,
      tasks: [
        {
          title: 'Prvá',
          description: '',
          assigneeIds: [],
          dueDate: null,
          urgent: false,
          fileIds: [],
          messageFileIds: [],
          link: null,
        },
        {
          title: 'Druhá',
          description: '',
          assigneeIds: [],
          dueDate: null,
          urgent: false,
          fileIds: [],
          messageFileIds: [],
          link: null,
        },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const ids = res.json<{ tasks: TaskDetailDto[] }>().tasks.map((t) => t.id);
    const rows = await auditRowsOfMany(db(), ids);
    expect(rows.map((r) => r.action)).toEqual(['created', 'created']);
    // One insert: the same created_at.
    expect(new Set(rows.map((r) => r.createdAt.getTime())).size).toBe(1);
  });

  it('bucket create, rename, delete record one row each; reordering buckets records nothing', async () => {
    const group = await newGroup();
    const created = await call('POST', `/api/groups/${group.id}/buckets`, admin.cookie, {
      name: 'Čaká',
    });
    expect(created.statusCode, created.body).toBe(201);
    const bucket = created.json<{ id: string }>();
    await call('PATCH', `/api/buckets/${bucket.id}`, admin.cookie, { name: 'Čaká na klienta' });
    await call('PATCH', `/api/buckets/${bucket.id}`, admin.cookie, { afterBucketId: null });
    await call('DELETE', `/api/buckets/${bucket.id}`, admin.cookie);
    const rows = await auditRowsOf(db(), bucket.id);
    expect(rows.map((r) => [r.action, r.entityLabel])).toEqual([
      ['created', 'Čaká'],
      ['renamed', 'Čaká na klienta'],
      ['deleted', 'Čaká na klienta'],
    ]);
    expect(rows[1]!.changes).toEqual({ name: { from: 'Čaká', to: 'Čaká na klienta' } });
  });

  it('an MCP move records an mcp row with the token', async () => {
    const group = await newGroup();
    const task = await create(group.id, { title: 'Cez AI' });
    const done = await bucketOf(group.id, 'done');
    const token = await mcpToken(db(), admin.id);
    const result = await callTool(test.app, token, 'move_task', {
      taskId: task.id,
      bucketId: done.id,
      afterTaskId: null,
    });
    expect(result.isError).toBe(false);
    const rows = await auditRowsOf(db(), task.id);
    expect(rows[1]).toMatchObject({
      action: 'completed',
      actorKind: 'mcp',
      actorUserId: admin.id,
      actorDetail: 'test',
    });
    expect(rows[1]!.actorTokenId).toBeTruthy();
  });
});
