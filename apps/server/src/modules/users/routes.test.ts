import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import type { Admin } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { latestEmail } from '../../../test/mailpit.js';
import { user } from './schema.js';
import { addAdmin, ensureSuperadmin, findUserByEmail } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;

describe('admins API', () => {
  let test: TestApp;
  const get = (cookie?: string) =>
    test.app.inject({ method: 'GET', url: '/api/admins', headers: cookie ? { cookie } : {} });
  const post = (
    cookie: string | undefined,
    payload: unknown,
    headers: Record<string, string> = {},
  ) =>
    test.app.inject({
      method: 'POST',
      url: '/api/admins',
      headers: { ...(cookie ? { cookie } : {}), ...headers },
      payload: payload as object,
    });
  const remove = (cookie: string | undefined, id: string) =>
    test.app.inject({
      method: 'DELETE',
      url: `/api/admins/${id}`,
      headers: cookie ? { cookie } : {},
    });

  /** An admin that exists and is logged in. */
  async function adminSession(name = 'Test Admin') {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name });
    return { admin, email, cookie: await loginAs(test.app, email) };
  }

  async function clientSession() {
    const email = newEmail();
    await test.deps.db
      .insert(user)
      .values({ id: randomUUID(), email, name: 'A Client', role: 'client', emailVerified: true });
    return { email, cookie: await loginAs(test.app, email) };
  }

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it('admin lists admins, superadmin first, disabled ones hidden', async () => {
    const { cookie } = await adminSession();
    const superEmail = newEmail();
    await ensureSuperadmin(test.deps.db, { email: superEmail, name: 'ZZ Boss' });
    const removed = await addAdmin(test.deps.db, { email: newEmail(), name: 'Removed One' });
    const { cookie: other } = await adminSession();
    expect((await remove(other, removed.id)).statusCode).toBe(204);

    const res = await get(cookie);
    expect(res.statusCode).toBe(200);
    const list = res.json<Admin[]>();
    const superIndex = list.findIndex((a) => a.email === superEmail);
    const firstAdmin = list.findIndex((a) => a.role === 'admin');
    expect(superIndex).toBeGreaterThanOrEqual(0);
    expect(superIndex).toBeLessThan(firstAdmin);
    expect(list.some((a) => a.id === removed.id)).toBe(false);
  });

  it('client gets 403 on GET/POST/DELETE', async () => {
    const { cookie } = await clientSession();
    const { admin } = await adminSession();
    for (const res of [
      await get(cookie),
      await post(cookie, { email: newEmail(), name: 'X' }),
      await remove(cookie, admin.id),
    ]) {
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    }
  });

  it('no session gets 401', async () => {
    for (const res of [
      await get(),
      await post(undefined, { email: newEmail(), name: 'X' }),
      await remove(undefined, 'whatever'),
    ]) {
      expect(res.statusCode).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('admin adds an admin, who receives the added email and can log in', async () => {
    const { cookie } = await adminSession('Adder Person');
    const email = newEmail();
    const res = await post(cookie, { email, name: 'New Person' }, { 'accept-language': 'en' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email, name: 'New Person', role: 'admin' });

    const mail = await latestEmail(email);
    expect(mail.subject).toBe('You were added to Spolu');
    expect(mail.text).toContain('Adder Person');
    expect(mail.text).toContain(`${test.deps.config.publicUrl}/login`);

    const newCookie = await loginAs(test.app, email);
    const me = await test.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: newCookie },
    });
    expect(me.statusCode).toBe(200);
  });

  it('adding with " NEW@Example.com " stores new@example.com', async () => {
    const { cookie } = await adminSession();
    const email = newEmail();
    const res = await post(cookie, { email: ` ${email.toUpperCase()} `, name: ' Spaced ' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ email, name: 'Spaced' });
    expect(await findUserByEmail(test.deps.db, email)).not.toBeNull();
  });

  it('duplicate admin email -> 409 email_taken_admin', async () => {
    const { cookie, email } = await adminSession();
    const res = await post(cookie, { email, name: 'Dup' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'email_taken_admin' });
  });

  it('client email -> 409 email_taken_client', async () => {
    const { cookie } = await adminSession();
    const { email } = await clientSession();
    const res = await post(cookie, { email, name: 'Dup' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'email_taken_client' });
  });

  it('two parallel POSTs with the same email -> one 201 and one 409', async () => {
    const { cookie } = await adminSession();
    const email = newEmail();
    const results = await Promise.all([
      post(cookie, { email, name: 'Race' }),
      post(cookie, { email, name: 'Race' }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
    const loser = results.find((r) => r.statusCode === 409)!;
    expect(loser.json()).toEqual({ error: 'email_taken_admin' });
  });

  it('invalid body -> 400 validation_failed', async () => {
    const { cookie } = await adminSession();
    for (const payload of [{}, { email: 'nope', name: 'X' }, { email: newEmail(), name: '  ' }]) {
      const res = await post(cookie, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    }
  });

  it("admin removes another admin -> 204, that admin's /api/me is 401 and their socket is disconnected", async () => {
    const { cookie } = await adminSession();
    const target = await adminSession('Target');
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const socket = connect(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      extraHeaders: { cookie: target.cookie },
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
      const disconnected = new Promise<void>((resolve) =>
        socket.once('disconnect', () => resolve()),
      );

      const res = await remove(cookie, target.admin.id);
      expect(res.statusCode).toBe(204);
      await disconnected;

      const me = await test.app.inject({
        method: 'GET',
        url: '/api/me',
        headers: { cookie: target.cookie },
      });
      expect(me.statusCode).toBe(401);
    } finally {
      socket.close();
    }
  });

  it('nobody removes the superadmin (403)', async () => {
    const { cookie } = await adminSession();
    const superEmail = newEmail();
    await ensureSuperadmin(test.deps.db, { email: superEmail, name: 'Boss' });
    const boss = (await findUserByEmail(test.deps.db, superEmail))!;
    expect((await remove(cookie, boss.id)).statusCode).toBe(403);
    const bossCookie = await loginAs(test.app, superEmail);
    expect((await remove(bossCookie, boss.id)).statusCode).toBe(403);
  });

  it('nobody removes themselves (403)', async () => {
    const { admin, cookie } = await adminSession();
    const res = await remove(cookie, admin.id);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it('removing a client is 403, an unknown id is 404', async () => {
    const { cookie } = await adminSession();
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'C', role: 'client', emailVerified: true });
    expect((await remove(cookie, id)).statusCode).toBe(403);
    const res = await remove(cookie, randomUUID());
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('removed admin re-added -> active again with the new name', async () => {
    const { cookie } = await adminSession();
    const email = newEmail();
    const first = (await post(cookie, { email, name: 'Old Name' })).json<Admin>();
    expect((await remove(cookie, first.id)).statusCode).toBe(204);

    const res = await post(cookie, { email, name: 'New Name' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: first.id, name: 'New Name' });
    const list = (await get(cookie)).json<Admin[]>();
    expect(list.find((a) => a.id === first.id)?.name).toBe('New Name');
  });
});
