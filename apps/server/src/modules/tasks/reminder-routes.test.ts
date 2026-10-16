import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import {
  RemindersEvents,
  type ReminderSetDto,
  type TaskDetailDto,
  type TaskRemindersEvent,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('task reminders API', () => {
  let test: TestApp;
  let baseUrl: string;
  const sockets: Socket[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
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

  async function newAdmin(): Promise<Person> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: 'Task Admin' });
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string): Promise<Person> {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Task Client', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () =>
    createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });

  async function newTask(cookie: string, groupId: string, over: { dueDate?: string | null } = {}) {
    const res = await call('POST', `/api/groups/${groupId}/tasks`, cookie, {
      title: 'Fix the budget table',
      dueDate: over.dueDate ?? null,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<TaskDetailDto>();
  }

  async function setup(over: { dueDate?: string | null } = {}) {
    const group = await newGroup();
    const [admin, client] = await Promise.all([newAdmin(), clientIn(group.id)]);
    const task = await newTask(admin.cookie, group.id, over);
    return { group, admin, client, task };
  }

  const url = (taskId: string) => `/api/tasks/${taskId}/reminders`;
  const put = (taskId: string, cookie: string, body: unknown) =>
    call('PUT', url(taskId), cookie, body);

  async function listen(cookie: string) {
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    return socket;
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

  it('GET with no set answers the empty set', async () => {
    const { client, task } = await setup();
    const res = await call('GET', url(task.id), client.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ times: [], recipients: [], subscribed: false, canEdit: true });
  });

  it('PUT creates the set with the caller as author and answers the set', async () => {
    const { client, task } = await setup();
    const at = inHours(2);
    const res = await put(task.id, client.cookie, { times: [{ at }] });
    expect(res.statusCode, res.body).toBe(200);
    const set = res.json<ReminderSetDto>();
    expect(set.times).toEqual([{ id: expect.any(String), at, firedAt: null }]);
    expect(set.recipients).toEqual([
      { user: { id: client.id, name: 'Task Client' }, source: 'author' },
    ]);
    expect(set.subscribed).toBe(true);
  });

  it('PUT with a past time is 400 reminder_in_past; the 21st time is 400 invalid_reminder; a recipient from another group is 400 invalid_recipient', async () => {
    const { admin, task } = await setup();
    const past = await put(task.id, admin.cookie, { times: [{ at: inHours(-1) }] });
    expect(past.statusCode).toBe(400);
    expect(past.json()).toEqual({ error: 'reminder_in_past' });

    const many = Array.from({ length: 21 }, (_, i) => ({ at: inHours(i + 1) }));
    const tooMany = await put(task.id, admin.cookie, { times: many });
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json()).toEqual({ error: 'invalid_reminder' });

    const stranger = await clientIn((await newGroup()).id);
    const foreign = await put(task.id, admin.cookie, {
      times: [{ at: inHours(1) }],
      recipientIds: [stranger.id],
    });
    expect(foreign.statusCode).toBe(400);
    expect(foreign.json()).toEqual({ error: 'invalid_recipient' });

    const bad = await put(task.id, admin.cookie, { times: [{ at: 'tomorrow' }] });
    expect(bad.json()).toEqual({ error: 'invalid_reminder' });
  });

  it("another group's client gets 404 on GET, PUT, subscription and calendar.ics", async () => {
    const { admin, task } = await setup({ dueDate: '2030-01-15' });
    await put(task.id, admin.cookie, { times: [{ at: inHours(1) }] });
    const stranger = await clientIn((await newGroup()).id);
    const responses = await Promise.all([
      call('GET', url(task.id), stranger.cookie),
      put(task.id, stranger.cookie, { times: [{ at: inHours(1) }] }),
      call('POST', `${url(task.id)}/subscription`, stranger.cookie),
      call('DELETE', `${url(task.id)}/subscription`, stranger.cookie),
      call('GET', `${url(task.id)}/calendar.ics`, stranger.cookie),
    ]);
    for (const res of responses) {
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('PUT on a deleted task is 404', async () => {
    const { admin, task } = await setup();
    expect((await call('DELETE', `/api/tasks/${task.id}`, admin.cookie)).statusCode).toBe(204);
    const res = await put(task.id, admin.cookie, { times: [{ at: inHours(1) }] });
    expect(res.statusCode).toBe(404);
  });

  it("subscribe then unsubscribe answers 204; the author's unsubscribe is 400 author_recipient", async () => {
    const { admin, client, task } = await setup();
    await put(task.id, admin.cookie, { times: [{ at: inHours(1) }] });
    expect((await call('POST', `${url(task.id)}/subscription`, client.cookie)).statusCode).toBe(
      204,
    );
    expect((await call('GET', url(task.id), client.cookie)).json<ReminderSetDto>().subscribed).toBe(
      true,
    );
    expect((await call('DELETE', `${url(task.id)}/subscription`, client.cookie)).statusCode).toBe(
      204,
    );
    const author = await call('DELETE', `${url(task.id)}/subscription`, admin.cookie);
    expect(author.statusCode).toBe(400);
    expect(author.json()).toEqual({ error: 'author_recipient' });
  });

  it('PUT emits reminders:task with the upcoming count; removing the last time emits 0', async () => {
    const { group, admin, client, task } = await setup();
    const socket = await listen(client.cookie);
    const next = () =>
      new Promise<TaskRemindersEvent>((resolve) => socket.once(RemindersEvents.task, resolve));

    let received = next();
    const res = await put(task.id, admin.cookie, {
      times: [{ at: inHours(1) }, { at: inHours(2) }],
    });
    expect(await received).toEqual({ groupId: group.id, taskId: task.id, upcomingReminders: 2 });

    received = next();
    const ids = res.json<ReminderSetDto>().times.map((t) => t.id);
    await put(task.id, admin.cookie, { times: [], baseTimeIds: ids });
    expect(await received).toEqual({ groupId: group.id, taskId: task.id, upcomingReminders: 0 });
  });

  it('calendar.ics for a task with only a deadline has one VALUE=DATE event; with neither it is 404', async () => {
    const { admin, task } = await setup({ dueDate: '2030-01-15' });
    const res = await call('GET', `${url(task.id)}/calendar.ics`, admin.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename="fix-the-budget-table.ics"',
    );
    expect(res.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(res.body).toContain('DTSTART;VALUE=DATE:20300115');

    const none = await setup();
    expect(
      (await call('GET', `${url(none.task.id)}/calendar.ics`, none.admin.cookie)).statusCode,
    ).toBe(404);
  });

  it("the deadline title follows the requester's saved language", async () => {
    const { client, task } = await setup({ dueDate: '2030-01-15' });
    await test.deps.db.update(user).set({ language: 'sk' }).where(eq(user.id, client.id));
    const res = await call('GET', `${url(task.id)}/calendar.ics`, client.cookie);
    expect(res.body).toContain('SUMMARY:Termín: Fix the budget table');
  });

  it('PUT writes over 120/min answer 429', async () => {
    const { admin, task } = await setup();
    let last = 0;
    for (let i = 0; i < 121; i++) {
      last = (await put(task.id, admin.cookie, { times: [] })).statusCode;
    }
    expect(last).toBe(429);
  }, 30_000); // 121 sequential requests
});
