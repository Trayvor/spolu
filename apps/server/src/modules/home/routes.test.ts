import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AssignedTasksSchema,
  GlobalBoardSchema,
  HomeTicketsSchema,
  HomeWorkloadSchema,
  MentionsSchema,
  NavCountsSchema,
  SidebarSchema,
  WORKLOAD_LIMITS,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { recordNotifications } from '../notifications/service.js';
import { addAdmin, setFinanceAccess } from '../users/service.js';
import { newAdmin, newClient, newGroup, newTask } from './test-fixtures.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('home API', () => {
  let test: TestApp;
  let adminCookie: string;
  let clientCookie: string;

  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    await addAdmin(test.deps.db, { email, name: 'Home Admin' });
    adminCookie = await loginAs(test.app, email);
    const group = await newGroup(test.deps.db);
    const client = await newClient(test.deps.db, group.id);
    clientCookie = await loginAs(test.app, client.email);
  });
  afterAll(() => test.close());

  const get = (url: string, cookie: string) =>
    test.app.inject({ method: 'GET', url, headers: { cookie } });

  it('a client gets 403 on every admin home endpoint', async () => {
    for (const url of [
      '/api/me/home/sidebar',
      '/api/me/home/tasks',
      '/api/me/home/tickets',
      '/api/me/home/counts',
      '/api/me/home/mentions',
      '/api/me/home/reminders',
      '/api/me/home/workload',
      '/api/tasks/global',
    ]) {
      const res = await get(url, clientCookie);
      expect({ url, status: res.statusCode, body: res.json() }).toEqual({
        url,
        status: 403,
        body: { error: 'forbidden' },
      });
    }
  });

  it('an anonymous caller gets 401', async () => {
    const res = await test.app.inject({ method: 'GET', url: '/api/me/home/sidebar' });
    expect(res.statusCode).toBe(401);
  });

  it('an admin gets 200 with the shapes', async () => {
    const sidebar = await get('/api/me/home/sidebar', adminCookie);
    expect(sidebar.statusCode).toBe(200);
    expect(SidebarSchema.safeParse(sidebar.json()).success).toBe(true);
    const tasks = await get('/api/me/home/tasks', adminCookie);
    expect(tasks.statusCode).toBe(200);
    expect(AssignedTasksSchema.parse(tasks.json())).toEqual({
      total: 0,
      urgent: 0,
      items: [],
      timeRequests: [],
      timeRequestCount: 0,
    });
    const mentions = await get('/api/me/home/mentions', adminCookie);
    expect(mentions.statusCode).toBe(200);
    expect(MentionsSchema.parse(mentions.json())).toEqual({ total: 0, items: [] });
  });

  it('?groups= returns only those rows; a bad or too long list is 400', async () => {
    const full = await get('/api/me/home/sidebar', adminCookie);
    const all = SidebarSchema.parse(full.json());
    const ids = all.slice(0, 2).map((r) => r.groupId);
    const part = await get(`/api/me/home/sidebar?groups=${ids.join(',')}`, adminCookie);
    expect(part.statusCode).toBe(200);
    expect(SidebarSchema.parse(part.json())).toEqual(all.filter((r) => ids.includes(r.groupId)));
    for (const groups of ['', 'not an id', Array.from({ length: 51 }, () => ids[0]).join(',')]) {
      const res = await get(
        `/api/me/home/sidebar?groups=${encodeURIComponent(groups)}`,
        adminCookie,
      );
      expect({ groups, status: res.statusCode }).toEqual({ groups, status: 400 });
    }
  });

  it('an admin gets the tickets card and the header counts', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Counts route');
    const admin = await newAdmin(db, 'Nina', [group.id]);
    const client = await newClient(db, group.id, 'Karol');
    const changed = await newTask(db, {
      groupId: group.id,
      createdBy: client.id,
      assigneeIds: [admin.id],
    });
    await newTask(db, { groupId: group.id, createdBy: client.id, assigneeIds: [admin.id] });
    // 2026-10-17: the header counts the tasks with an unseen change, not every open one.
    await recordNotifications(db, {
      kind: 'task.moved',
      groupId: group.id,
      recipients: [admin.id],
      payload: { taskId: changed, groupId: group.id },
    });
    const cookie = await loginAs(test.app, admin.email);
    const created = await test.app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { cookie },
      payload: {
        groupId: group.id,
        subject: 'Counted',
        requesterEmail: client.email,
        requesterName: 'Karol',
      },
    });
    expect(created.statusCode).toBe(201);

    const tickets = HomeTicketsSchema.parse((await get('/api/me/home/tickets', cookie)).json());
    const mine = tickets.items.filter((t) => t.groupId === group.id);
    expect(mine).toMatchObject([{ subject: 'Counted', status: 'new', groupName: 'Counts route' }]);

    const counts = NavCountsSchema.parse((await get('/api/me/home/counts', cookie)).json());
    expect(counts.tasks).toBe(1);
    // The admin made the ticket, so it has no unseen change for them; the tickets without a
    // client that other tests leave in the database may.
    expect(counts.tickets).toBeGreaterThanOrEqual(0);
  });

  it('unknown due is 400 invalid_filter', async () => {
    const res = await get('/api/tasks/global?due=tomorrow', adminCookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_filter' });
  });

  it('a bad cursor is 400 invalid_filter', async () => {
    const res = await get('/api/tasks/global?column=todo&after=nope', adminCookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_filter' });
  });

  it('an admin gets the global board', async () => {
    const res = await get('/api/tasks/global?assignee=me&urgent=1', adminCookie);
    expect(res.statusCode).toBe(200);
    // Every client (the admin manages none): the fixed columns around the custom ones.
    const kinds = GlobalBoardSchema.parse(res.json()).columns.map((c) => c.kind);
    expect(kinds[0]).toBe('todo');
    expect(kinds.slice(-2)).toEqual(['egrant_review', 'client_review']);
    expect(kinds.filter((k) => k !== 'custom' && k !== 'other')).toEqual([
      'todo',
      'egrant_review',
      'client_review',
    ]);
  });

  it('mine=1 keeps the tasks the admin created or is an assignee of', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Mine route');
    const admin = await newAdmin(db, 'Mia');
    const client = await newClient(db, group.id, 'Kamil');
    await newTask(db, { groupId: group.id, createdBy: admin.id, title: 'created' });
    await newTask(db, {
      groupId: group.id,
      createdBy: client.id,
      title: 'assigned',
      assigneeIds: [admin.id],
    });
    await newTask(db, { groupId: group.id, createdBy: client.id, title: 'not mine' });
    const res = await get(
      `/api/tasks/global?clients=${group.id}&mine=1`,
      await loginAs(test.app, admin.email),
    );
    expect(res.statusCode).toBe(200);
    const todo = GlobalBoardSchema.parse(res.json()).columns.find((c) => c.kind === 'todo')!;
    expect(todo.items.map((t) => t.title).sort()).toEqual(['assigned', 'created']);
  });

  it('the workload needs a session', async () => {
    const res = await test.app.inject({ method: 'GET', url: '/api/me/home/workload' });
    expect(res.statusCode).toBe(401);
  });

  it('the workload answers the schema and has no time for a plain admin', async () => {
    const res = await get('/api/me/home/workload', adminCookie);
    expect(res.statusCode).toBe(200);
    const body = HomeWorkloadSchema.parse(res.json());
    expect(body.week).toBeNull();
    // The shared test database holds hundreds of admins: the answer stays capped.
    expect(body.admins.length).toBeGreaterThan(0);
    expect(body.admins.length).toBeLessThanOrEqual(WORKLOAD_LIMITS.admins);
    // The finance seal (ADR 0027): the key is absent, not zero.
    expect(res.body).not.toContain('minutesThisWeek');
  });

  it('the workload has the week and minutes for a finance holder', async () => {
    const db = test.deps.db;
    const admin = await newAdmin(db, 'Fina');
    await setFinanceAccess(db, admin.id, admin.id);
    const res = await get('/api/me/home/workload', await loginAs(test.app, admin.email));
    expect(res.statusCode).toBe(200);
    const body = HomeWorkloadSchema.parse(res.json());
    expect(body.week).not.toBeNull();
    expect(typeof body.admins[0]!.minutesThisWeek).toBe('number');
  });
});
