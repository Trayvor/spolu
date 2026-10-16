import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { MeSchema, type Role } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { cookieHeader, loginAs, requestCode, signIn } from '../../../test/login.js';
import { countEmailsTo, latestEmail, latestLoginCode } from '../../../test/mailpit.js';
import { user } from '../users/schema.js';
import { session, verification } from './schema.js';
import { revokeAllSessions } from './service.js';
import { requireAdmin, requireUser } from './session.js';

let test: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;

beforeAll(async () => {
  test = await buildTestApp();
  app = test.app;
  // Routes that exist only in this test, to exercise the preHandlers.
  app.get('/api/test/user-only', { preHandler: requireUser(app.auth) }, async (request) => ({
    id: request.user?.id,
  }));
  app.get('/api/test/admin-only', { preHandler: requireAdmin(app.auth) }, async (request) => ({
    role: request.user?.role,
  }));
  app.post('/api/test/echo', async (request) => request.body);
});
afterAll(async () => {
  await app.close();
  await test.close();
});

const uniqueEmail = (): string => `${randomUUID()}@example.com`;

async function createUser(role: Role = 'admin', opts: { disabled?: boolean } = {}) {
  const email = uniqueEmail();
  const id = randomUUID();
  await test.deps.db.insert(user).values({
    id,
    email,
    name: `User ${id}`,
    role,
    emailVerified: true,
    disabledAt: opts.disabled ? new Date() : null,
  });
  return { id, email };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('email code login', () => {
  it('queues the login code email with a short expiry', async () => {
    const admin = await createUser('admin');
    const send = vi.spyOn(test.deps.jobs, 'send');
    await requestCode(app, admin.email);
    expect(send).toHaveBeenCalledWith(
      'email.send',
      expect.objectContaining({ to: [admin.email] }),
      expect.objectContaining({ expireInSeconds: 240 }),
    );
    send.mockRestore();
  });

  it('known admin gets a code by email and signs in', async () => {
    const admin = await createUser('admin');
    const sent = await requestCode(app, admin.email);
    expect(sent.statusCode).toBe(200);
    expect(sent.json()).toEqual({ success: true });

    const res = await signIn(app, admin.email, await latestLoginCode(admin.email));
    expect(res.statusCode).toBe(200);
    const cookie = cookieHeader(res);
    expect(cookie).toContain('better-auth.session_token=');
    const setCookie = String(res.headers['set-cookie']);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
    expect(MeSchema.strict().parse(me.json())).toEqual({
      id: admin.id,
      email: admin.email,
      name: `User ${admin.id}`,
      role: 'admin',
      groups: [],
    });
  });

  it('accepts the email in capitals', async () => {
    const admin = await createUser('admin');
    const typed = admin.email.toUpperCase();
    expect((await requestCode(app, typed)).statusCode).toBe(200);
    const res = await signIn(app, typed, await latestLoginCode(admin.email));
    expect(res.statusCode).toBe(200);
  });

  it('unknown email gets 200 { success: true } and no email', async () => {
    const email = uniqueEmail();
    const res = await requestCode(app, email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    await sleep(1000);
    expect(await countEmailsTo(email)).toBe(0);
  });

  it('disabled user gets 200 and no email', async () => {
    const disabled = await createUser('admin', { disabled: true });
    const res = await requestCode(app, disabled.email);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true });
    await sleep(1000);
    expect(await countEmailsTo(disabled.email)).toBe(0);
  });

  it('wrong code is 400 INVALID_OTP', async () => {
    const admin = await createUser('admin');
    await requestCode(app, admin.email);
    const right = await latestLoginCode(admin.email);
    const wrong = right === '000000' ? '111111' : '000000';
    const res = await signIn(app, admin.email, wrong);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'INVALID_OTP' });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('three wrong codes burn the code: the right code then fails with 403 TOO_MANY_ATTEMPTS', async () => {
    const admin = await createUser('admin');
    await requestCode(app, admin.email);
    const right = await latestLoginCode(admin.email);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) {
      expect((await signIn(app, admin.email, wrong)).statusCode).toBe(400);
    }
    const res = await signIn(app, admin.email, right);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
  });

  it('expired code is 400 OTP_EXPIRED', async () => {
    const admin = await createUser('admin');
    await requestCode(app, admin.email);
    const code = await latestLoginCode(admin.email);
    await test.deps.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `sign-in-otp-${admin.email}`));
    const res = await signIn(app, admin.email, code);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('stores the code hashed, never in plain text', async () => {
    const admin = await createUser('admin');
    await requestCode(app, admin.email);
    const code = await latestLoginCode(admin.email);
    const [row] = await test.deps.db
      .select({ value: verification.value })
      .from(verification)
      .where(eq(verification.identifier, `sign-in-otp-${admin.email}`));
    expect(row?.value).toBeDefined();
    expect(row?.value).not.toContain(code);
  });

  it('a disabled user with a valid code gets 403 ACCOUNT_DISABLED and no cookie', async () => {
    const admin = await createUser('admin');
    await requestCode(app, admin.email);
    const code = await latestLoginCode(admin.email);
    await test.deps.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, admin.id));

    const res = await signIn(app, admin.email, code);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'ACCOUNT_DISABLED' });
    expect(res.headers['set-cookie']).toBeUndefined();
    const rows = await test.deps.db.select().from(session).where(eq(session.userId, admin.id));
    expect(rows).toHaveLength(0);
  });

  it('the code email follows Accept-Language (en: English, missing: Slovak)', async () => {
    const en = await createUser('admin');
    await requestCode(app, en.email, { 'accept-language': 'en-GB,en;q=0.9' });
    expect((await latestEmail(en.email)).subject).toMatch(
      /^Your Help by eGrant login code: \d{6}$/,
    );

    const sk = await createUser('admin');
    await requestCode(app, sk.email);
    expect((await latestEmail(sk.email)).subject).toMatch(
      /^Váš prihlasovací kód do aplikácie Help: \d{6}$/,
    );
  });
});

describe('session', () => {
  it('GET /api/me without a cookie is 401 { error: unauthorized }', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'unauthorized' });
  });

  it('GET /api/me with a forged cookie is 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: 'better-auth.session_token=forged.signature' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('revokeAllSessions makes /api/me 401', async () => {
    const admin = await createUser('admin');
    const cookie = await loginAs(app, admin.email);
    expect(
      (await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode,
    ).toBe(200);

    await revokeAllSessions(test.deps.db, admin.id);
    const res = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(res.statusCode).toBe(401);
  });

  it('a disabled user with a live session is treated as logged out', async () => {
    const admin = await createUser('admin');
    const cookie = await loginAs(app, admin.email);
    await test.deps.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, admin.id));
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
    expect(me.headers['set-cookie']).toBeUndefined();
    const guarded = await app.inject({
      method: 'GET',
      url: '/api/test/user-only',
      headers: { cookie },
    });
    expect(guarded.statusCode).toBe(401);
  });

  it('sign-out with body {} clears the session', async () => {
    const admin = await createUser('admin');
    const cookie = await loginAs(app, admin.email);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('better-auth.session_token=;');
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(401);
  });

  it('rejects a cookie-carrying auth request from a foreign origin', async () => {
    const admin = await createUser('admin');
    const cookie = await loginAs(app, admin.email);
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie, origin: 'http://evil.example' },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(me.statusCode).toBe(200);
  });
});

describe('auth endpoint allow-list', () => {
  it('better-auth endpoints we do not use answer our JSON 404', async () => {
    const admin = await createUser('admin');
    const cookie = await loginAs(app, admin.email);
    const update = await app.inject({
      method: 'POST',
      url: '/api/auth/update-user',
      headers: { cookie, origin: 'http://localhost:3000' },
      payload: { name: 'Hacked' },
    });
    expect(update.statusCode).toBe(404);
    expect(update.json()).toEqual({ error: 'not_found' });
    const [row] = await test.deps.db.select().from(user).where(eq(user.id, admin.id));
    expect(row?.name).toBe(`User ${admin.id}`);

    const list = await app.inject({
      method: 'GET',
      url: '/api/auth/list-sessions',
      headers: { cookie },
    });
    expect(list.statusCode).toBe(404);
    expect(list.json()).toEqual({ error: 'not_found' });
  });

  it('GET /api/auth/get-session is closed (the web uses /api/me)', async () => {
    const admin = await createUser('admin');
    const cookie = await loginAs(app, admin.email);
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/get-session',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});

describe('route guards', () => {
  it('requireUser gives 401 without a session and passes the user through with one', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/test/user-only' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toEqual({ error: 'unauthorized' });

    const client = await createUser('client');
    const cookie = await loginAs(app, client.email);
    const res = await app.inject({
      method: 'GET',
      url: '/api/test/user-only',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: client.id });
  });

  it('requireAdmin gives 403 to a client and lets an admin in', async () => {
    const client = await createUser('client');
    const clientCookie = await loginAs(app, client.email);
    const denied = await app.inject({
      method: 'GET',
      url: '/api/test/admin-only',
      headers: { cookie: clientCookie },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ error: 'forbidden' });

    const admin = await createUser('admin');
    const adminCookie = await loginAs(app, admin.email);
    const allowed = await app.inject({
      method: 'GET',
      url: '/api/test/admin-only',
      headers: { cookie: adminCookie },
    });
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toEqual({ role: 'admin' });

    const anonymous = await app.inject({ method: 'GET', url: '/api/test/admin-only' });
    expect(anonymous.statusCode).toBe(401);
  });

  it('other routes still parse JSON normally', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/test/echo', payload: { a: 1 } });
    expect(res.json()).toEqual({ a: 1 });
  });
});

describe('rate limiting in production', () => {
  let prod: Awaited<ReturnType<typeof buildTestApp>>;
  beforeAll(async () => {
    prod = await buildTestApp({
      config: { nodeEnv: 'production', appSecret: randomBytes(32).toString('hex') },
    });
  });
  afterAll(async () => {
    await prod.app.close();
    await prod.close();
  });

  it('the 11th code request from the same IP within a minute is 429', async () => {
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) statuses.push((await requestCode(prod.app, email)).statusCode);
    expect(statuses).toEqual([...Array<number>(10).fill(200), 429]);
  });
});
