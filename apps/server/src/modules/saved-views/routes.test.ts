import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SAVED_VIEW_LIMITS, type SavedView } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { savedViews } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('saved views API (F5)', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const call = (method: 'GET' | 'POST' | 'DELETE', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  async function admin() {
    const email = `${randomUUID()}@example.com`;
    const a = await addAdmin(test.deps.db, { email, name: 'Ada' });
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  const save = (cookie: string, body: object) => call('POST', '/api/me/saved-views', cookie, body);

  it('saves, lists per page and deletes the caller own views', async () => {
    const ada = await admin();
    const ben = await admin();
    const res = await save(ada.cookie, {
      page: 'board',
      name: 'Po termíne',
      url: '/tasks?mine=1&due=overdue',
    });
    expect(res.statusCode).toBe(201);
    const view = res.json<SavedView>();
    expect(view).toMatchObject({
      page: 'board',
      name: 'Po termíne',
      url: '/tasks?mine=1&due=overdue',
    });
    await save(ada.cookie, {
      page: 'tickets',
      name: 'Bez riešiteľa',
      url: '/tickets?assignee=none',
    });
    const board = (await call('GET', '/api/me/saved-views?page=board', ada.cookie)).json<
      SavedView[]
    >();
    expect(board.map((v) => v.id)).toEqual([view.id]);
    expect((await call('GET', '/api/me/saved-views?page=board', ben.cookie)).json()).toEqual([]);
    // Another person's view is not theirs to delete.
    expect((await call('DELETE', `/api/me/saved-views/${view.id}`, ben.cookie)).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', `/api/me/saved-views/${view.id}`, ada.cookie)).statusCode).toBe(
      204,
    );
    expect((await call('GET', '/api/me/saved-views?page=board', ada.cookie)).json()).toEqual([]);
  });

  it.each([
    ['another page', '/tickets?status=all'],
    ['another host', 'https://evil.example/tasks?x=1'],
    ['a path under the page', '/tasks/123?x=1'],
    ['no filters', '/tasks'],
    ['a fragment', '/tasks?x=1#y'],
  ])('refuses a URL with %s', async (_case, url) => {
    const ada = await admin();
    expect((await save(ada.cookie, { page: 'board', name: 'X', url })).statusCode).toBe(400);
  });

  it('a client has no views; an unknown page is refused', async () => {
    const ada = await admin();
    const c = await createUnverifiedClient(test.deps.db, `${randomUUID()}@example.com`, 'Klient');
    const cookie = await loginAs(test.app, c.email);
    expect((await call('GET', '/api/me/saved-views?page=board', cookie)).statusCode).toBe(403);
    const view = { page: 'tickets', name: 'X', url: '/tickets?assignee=none' };
    expect((await save(cookie, view)).statusCode).toBe(403);
    expect((await call('GET', '/api/me/saved-views?page=nope', ada.cookie)).statusCode).toBe(400);
    // Finance keeps its filters in the browser, not the URL: it has no views (yet).
    const finance = { page: 'finance', name: 'X', url: '/finance?status=open' };
    expect((await save(ada.cookie, finance)).statusCode).toBe(400);
  });

  it('caps the views per page', async () => {
    const ada = await admin();
    await test.deps.db.insert(savedViews).values(
      Array.from({ length: SAVED_VIEW_LIMITS.perPage }, (_, i) => ({
        id: randomUUID(),
        userId: ada.id,
        page: 'knowledge' as const,
        name: `V${i}`,
        url: `/knowledge?q=v${i}`,
      })),
    );
    const over = await save(ada.cookie, {
      page: 'knowledge',
      name: 'One more',
      url: '/knowledge?q=x',
    });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toEqual({ error: 'saved_view_limit' });
  });
});
