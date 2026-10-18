import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SNIPPET_LIMITS, type Snippet } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createGroup } from '../groups/service.js';
import { addMembership } from '../groups/memberships.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { replySnippets } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('snippets API (F7)', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  async function admin(name = 'Ada') {
    const email = `${randomUUID()}@example.com`;
    const a = await addAdmin(test.deps.db, { email, name });
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function client() {
    const group = await createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://s${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`,
    });
    const c = await createUnverifiedClient(test.deps.db, `${randomUUID()}@example.com`, 'Klient');
    await addMembership(test.deps.db, c.id, group.id, 'client');
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  const create = async (cookie: string, body: object) => {
    const res = await call('POST', '/api/snippets', cookie, body);
    expect(res.statusCode).toBe(201);
    return res.json<Snippet>();
  };

  it('an admin lists their own and the shared snippets, never another private one', async () => {
    const ada = await admin('Ada');
    const ben = await admin('Ben');
    const own = await create(ada.cookie, { title: 'Ďakujeme', body: 'Ďakujeme, {{name}}.' });
    const shared = await create(ben.cookie, {
      title: 'Prístup',
      body: 'Potrebujeme prístup.',
      shared: true,
    });
    const hidden = await create(ben.cookie, { title: 'Moje', body: 'Len moje.' });
    expect(own).toMatchObject({ mine: true, shared: false, authorName: 'Ada' });
    const list = (await call('GET', '/api/snippets', ada.cookie)).json<Snippet[]>();
    const ids = list.map((s) => s.id);
    expect(ids).toContain(own.id);
    expect(ids).toContain(shared.id);
    expect(ids).not.toContain(hidden.id);
    expect(list.find((s) => s.id === shared.id)).toMatchObject({ mine: false, authorName: 'Ben' });
  });

  it('only the author changes or deletes a snippet', async () => {
    const ada = await admin();
    const ben = await admin();
    const shared = await create(ada.cookie, { title: 'A', body: 'B', shared: true });
    const priv = await create(ada.cookie, { title: 'C', body: 'D' });
    expect(
      (await call('PATCH', `/api/snippets/${shared.id}`, ben.cookie, { title: 'X' })).statusCode,
    ).toBe(403);
    expect((await call('DELETE', `/api/snippets/${shared.id}`, ben.cookie)).statusCode).toBe(403);
    // Another admin's private snippet does not exist for them.
    expect(
      (await call('PATCH', `/api/snippets/${priv.id}`, ben.cookie, { title: 'X' })).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/api/snippets/${priv.id}`, ben.cookie)).statusCode).toBe(404);
    const edited = await call('PATCH', `/api/snippets/${shared.id}`, ada.cookie, {
      title: 'New',
      shared: false,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json()).toMatchObject({ title: 'New', shared: false });
    expect((await call('DELETE', `/api/snippets/${shared.id}`, ada.cookie)).statusCode).toBe(204);
    expect((await call('DELETE', `/api/snippets/${shared.id}`, ada.cookie)).statusCode).toBe(404);
  });

  it('a client gets 403 everywhere', async () => {
    const c = await client();
    expect((await call('GET', '/api/snippets', c.cookie)).statusCode).toBe(403);
    expect(
      (await call('POST', '/api/snippets', c.cookie, { title: 'A', body: 'B' })).statusCode,
    ).toBe(403);
  });

  it('validates the body and caps the count per author', async () => {
    const ada = await admin();
    expect(
      (await call('POST', '/api/snippets', ada.cookie, { title: ' ', body: 'B' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call('POST', '/api/snippets', ada.cookie, {
          title: 'A',
          body: 'x'.repeat(SNIPPET_LIMITS.body + 1),
        })
      ).statusCode,
    ).toBe(400);
    await test.deps.db.insert(replySnippets).values(
      Array.from({ length: SNIPPET_LIMITS.perUser }, (_, i) => ({
        id: randomUUID(),
        authorId: ada.id,
        title: `S${i}`,
        body: 'b',
      })),
    );
    const over = await call('POST', '/api/snippets', ada.cookie, { title: 'A', body: 'B' });
    expect(over.statusCode).toBe(409);
    expect(over.json()).toEqual({ error: 'snippet_limit' });
  });
});
