import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { BoardEvents, type BoardBucketsEvent, type BoardDto, type BucketDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('tasks API: board and buckets', () => {
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

  async function adminSession() {
    const email = newEmail();
    await addAdmin(test.deps.db, { email, name: 'Board Admin' });
    return { cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string) {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'A Client', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, email, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () => createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });
  const board = async (cookie: string, groupId: string) =>
    (await call('GET', `/api/groups/${groupId}/board`, cookie)).json<BoardDto>();

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
    expect((await call('GET', `/api/groups/${g.id}/board`)).statusCode).toBe(401);
    expect((await call('POST', `/api/groups/${g.id}/buckets`, undefined, {})).statusCode).toBe(401);
  });

  it('admin GET board → 4 buckets in order, no tasks', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const res = await call('GET', `/api/groups/${g.id}/board`, cookie);
    expect(res.statusCode).toBe(200);
    const body = res.json<BoardDto>();
    expect(body.buckets.map((b) => b.kind)).toEqual([
      'todo',
      'egrant_review',
      'client_review',
      'done',
    ]);
    expect(body.buckets.every((b) => b.groupId === g.id && b.name === null)).toBe(true);
    expect(body.tasks).toEqual([]);
  });

  it('GET board of an unknown group → 404 and creates nothing', async () => {
    const { cookie } = await adminSession();
    expect((await call('GET', '/api/groups/nope/board', cookie)).statusCode).toBe(404);
  });

  it('client of the group reads the board; client of another group gets 404 everywhere', async () => {
    const { cookie: adminCookie } = await adminSession();
    const g = await newGroup();
    const other = await newGroup();
    const mine = await clientIn(g.id);
    const stranger = await clientIn(other.id);
    expect((await call('GET', `/api/groups/${g.id}/board`, mine.cookie)).statusCode).toBe(200);

    const custom = (
      await call('POST', `/api/groups/${g.id}/buckets`, adminCookie, { name: 'Extra' })
    ).json<BucketDto>();
    expect((await call('GET', `/api/groups/${g.id}/board`, stranger.cookie)).statusCode).toBe(404);
    expect(
      (await call('POST', `/api/groups/${g.id}/buckets`, stranger.cookie, { name: 'X' }))
        .statusCode,
    ).toBe(404);
    expect(
      (await call('PATCH', `/api/buckets/${custom.id}`, stranger.cookie, { name: 'X' })).statusCode,
    ).toBe(404);
    expect((await call('DELETE', `/api/buckets/${custom.id}`, stranger.cookie)).statusCode).toBe(
      404,
    );
    expect((await call('PATCH', '/api/buckets/nope', adminCookie, { name: 'X' })).statusCode).toBe(
      404,
    );
    expect((await call('DELETE', '/api/buckets/nope', adminCookie)).statusCode).toBe(404);
  });

  it('client POST / PATCH / DELETE bucket → 403', async () => {
    const { cookie: adminCookie } = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const custom = (
      await call('POST', `/api/groups/${g.id}/buckets`, adminCookie, { name: 'Extra' })
    ).json<BucketDto>();
    expect(
      (await call('POST', `/api/groups/${g.id}/buckets`, client.cookie, { name: 'X' })).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/api/buckets/${custom.id}`, client.cookie, { name: 'X' })).statusCode,
    ).toBe(403);
    expect((await call('DELETE', `/api/buckets/${custom.id}`, client.cookie)).statusCode).toBe(403);
  });

  it('admin creates, renames, reorders, deletes a custom bucket', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const created = await call('POST', `/api/groups/${g.id}/buckets`, cookie, { name: ' Review ' });
    expect(created.statusCode).toBe(201);
    const bucket = created.json<BucketDto>();
    expect(bucket).toMatchObject({ kind: 'custom', name: 'Review', groupId: g.id });

    const renamed = await call('PATCH', `/api/buckets/${bucket.id}`, cookie, { name: 'QA' });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<BucketDto>().name).toBe('QA');

    const fixed = (await board(cookie, g.id)).buckets;
    const client = fixed.find((b) => b.kind === 'client_review')!;
    const moved = await call('PATCH', `/api/buckets/${bucket.id}`, cookie, {
      afterBucketId: client.id,
    });
    expect(moved.statusCode).toBe(200);
    expect((await board(cookie, g.id)).buckets.map((b) => b.kind)).toEqual([
      'todo',
      'egrant_review',
      'client_review',
      'custom',
      'done',
    ]);

    const bad = await call('PATCH', `/api/buckets/${bucket.id}`, cookie, {
      afterBucketId: bucket.id,
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'validation_failed' });

    expect((await call('DELETE', `/api/buckets/${bucket.id}`, cookie)).statusCode).toBe(204);
    expect((await board(cookie, g.id)).buckets).toHaveLength(4);
  });

  it('admin reorders fixed buckets; everyone viewing gets board:buckets; a client gets 403', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const fixed = (await board(cookie, g.id)).buckets;
    const done = fixed.find((b) => b.kind === 'done')!;
    const todo = fixed.find((b) => b.kind === 'todo')!;
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie: client.cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    const received = new Promise<BoardBucketsEvent>((resolve) =>
      socket.once(BoardEvents.buckets, resolve),
    );

    const refused = await call('PATCH', `/api/buckets/${done.id}`, client.cookie, {
      afterBucketId: null,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'forbidden' });

    const first = await call('PATCH', `/api/buckets/${done.id}`, cookie, { afterBucketId: null });
    expect(first.statusCode).toBe(200);
    const last = await call('PATCH', `/api/buckets/${todo.id}`, cookie, {
      afterBucketId: fixed.find((b) => b.kind === 'client_review')!.id,
    });
    expect(last.statusCode).toBe(200);
    const order = ['done', 'egrant_review', 'client_review', 'todo'];
    expect((await board(client.cookie, g.id)).buckets.map((b) => b.kind)).toEqual(order);
    const event = await received;
    expect(event.groupId).toBe(g.id);
    expect(event.buckets.map((b) => b.kind)).toEqual([
      'done',
      'todo',
      'egrant_review',
      'client_review',
    ]);
  });

  it('PATCH or DELETE a fixed bucket → 400 fixed_bucket', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const todo = (await board(cookie, g.id)).buckets[0]!;
    const patch = await call('PATCH', `/api/buckets/${todo.id}`, cookie, { name: 'x' });
    expect(patch.statusCode).toBe(400);
    expect(patch.json()).toEqual({ error: 'fixed_bucket' });
    const del = await call('DELETE', `/api/buckets/${todo.id}`, cookie);
    expect(del.statusCode).toBe(400);
    expect(del.json()).toEqual({ error: 'fixed_bucket' });
  });

  it('invalid name or body → 400 validation_failed', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    for (const payload of [{}, { name: '   ' }, { name: 'x'.repeat(61) }, { name: 5 }]) {
      const res = await call('POST', `/api/groups/${g.id}/buckets`, cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    }
    const custom = (
      await call('POST', `/api/groups/${g.id}/buckets`, cookie, { name: 'Ok' })
    ).json<BucketDto>();
    const empty = await call('PATCH', `/api/buckets/${custom.id}`, cookie, {});
    expect(empty.statusCode).toBe(400);
  });

  it('a client socket in the group receives board:buckets after a create', async () => {
    const { cookie } = await adminSession();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie: client.cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    const received = new Promise<BoardBucketsEvent>((resolve) =>
      socket.once(BoardEvents.buckets, resolve),
    );
    await call('POST', `/api/groups/${g.id}/buckets`, cookie, { name: 'Live' });
    const event = await received;
    expect(event.groupId).toBe(g.id);
    expect(event.buckets.map((b) => b.name)).toEqual([null, 'Live', null, null, null]);
  });

  it('the 121st write within a minute → 429 rate_limited', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    for (let i = 1; i <= 120; i++) {
      const res = await call('POST', `/api/groups/${g.id}/buckets`, client.cookie);
      expect(res.statusCode, `request ${i}`).not.toBe(429);
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
    const res = await call('POST', `/api/groups/${g.id}/buckets`, client.cookie);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });
});
