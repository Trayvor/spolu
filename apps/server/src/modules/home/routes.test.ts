import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AssignedTasksSchema, MentionsSchema, SidebarSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addAdmin } from '../users/service.js';
import { newClient, newGroup } from './test-fixtures.js';

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
    for (const url of ['/api/me/home/sidebar', '/api/me/home/tasks', '/api/me/home/mentions']) {
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
    expect(AssignedTasksSchema.parse(tasks.json())).toEqual({ total: 0, urgent: 0, items: [] });
    const mentions = await get('/api/me/home/mentions', adminCookie);
    expect(mentions.statusCode).toBe(200);
    expect(MentionsSchema.parse(mentions.json())).toEqual({ total: 0, items: [] });
  });
});
