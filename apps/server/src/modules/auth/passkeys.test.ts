import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, like } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/server';
import { MeSchema, PasskeyListSchema, PASSKEY_LIMITS, type Role } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { cookieHeader, loginAs, requestCode, signIn } from '../../../test/login.js';
import { emailWithSubject, latestLoginCode, loginCodeIn } from '../../../test/mail.js';
import { createPasskey, signInWithPasskey, type SoftPasskey } from '../../../test/webauthn.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { user } from '../users/schema.js';
import { deactivateUser } from '../users/service.js';
import { passkeys, session, verification } from './schema.js';

let test: Awaited<ReturnType<typeof buildTestApp>>;
let app: FastifyInstance;

beforeAll(async () => {
  // Many sign-ins from one address; the limits have their own test below.
  test = await buildTestApp({ config: { loginCodesPerMinute: 1000 } });
  app = test.app;
});
afterAll(async () => {
  await app.close();
  await test.close();
});

async function createUser(role: Role = 'admin') {
  const id = randomUUID();
  const email = `${id}@example.com`;
  await test.deps.db
    .insert(user)
    .values({ id, email, name: `User ${id}`, role, emailVerified: true });
  return { id, email };
}

/** A signed-in admin whose session is fresh (just logged in with a code). */
async function signedInAdmin() {
  const admin = await createUser('admin');
  return { ...admin, cookie: await loginAs(app, admin.email) };
}

/** Moves every session of the user 11 minutes into the past: no longer fresh. */
async function makeStale(userId: string) {
  await test.deps.db
    .update(session)
    .set({ createdAt: new Date(Date.now() - 11 * 60_000) })
    .where(eq(session.userId, userId));
}

const post = (
  url: string,
  payload: unknown,
  cookie?: string,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method: 'POST',
    url,
    payload: payload as object,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });

async function registrationOptions(cookie: string, body: object = {}) {
  const res = await post('/api/me/passkeys/options', body, cookie);
  expect(res.statusCode).toBe(200);
  return res.json() as PublicKeyCredentialCreationOptionsJSON;
}

/** Registers a new passkey for the signed-in admin; answers it. */
async function registerPasskey(cookie: string, name = 'Laptop'): Promise<SoftPasskey> {
  const { response, passkey } = createPasskey(await registrationOptions(cookie));
  const res = await post('/api/me/passkeys', { name, response }, cookie);
  expect(res.statusCode).toBe(201);
  return passkey;
}

async function loginOptions() {
  const res = await post('/api/auth/passkey/options', {});
  expect(res.statusCode).toBe(200);
  return res.json() as PublicKeyCredentialRequestOptionsJSON;
}

const passkeySignIn = (response: unknown, headers: Record<string, string> = {}) =>
  post('/api/auth/passkey/sign-in', { response }, undefined, headers);

describe('passkey registration (admins, in settings)', () => {
  it('a fresh admin session gets options for a discoverable, user-verified passkey', async () => {
    const admin = await signedInAdmin();
    const options = await registrationOptions(admin.cookie);
    expect(options.rp.id).toBe('localhost');
    expect(options.user.name).toBe(admin.email);
    // Not our user id: an opaque handle.
    expect(options.user.id).not.toContain(admin.id);
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: 'required',
      userVerification: 'required',
    });
    expect(options.attestation).toBe('none');
  });

  it('registers, lists with dates, emails the admin and deletes', async () => {
    const admin = await signedInAdmin();
    await registerPasskey(admin.cookie, 'Work laptop');

    const list = await app.inject({
      method: 'GET',
      url: '/api/me/passkeys',
      headers: { cookie: admin.cookie },
    });
    expect(list.statusCode).toBe(200);
    const items = PasskeyListSchema.parse(list.json());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Work laptop', lastUsedAt: null });
    expect(Date.parse(items[0]!.createdAt)).toBeGreaterThan(Date.now() - 60_000);

    const notice = await emailWithSubject(admin.email, serverTexts('sk').auth.passkeyAdded.subject);
    expect(notice.text).toContain('Work laptop');

    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${items[0]!.id}`,
      headers: { cookie: admin.cookie },
    });
    expect(gone.statusCode).toBe(204);
    const after = await app.inject({
      method: 'GET',
      url: '/api/me/passkeys',
      headers: { cookie: admin.cookie },
    });
    expect(after.json()).toEqual([]);
  });

  it('excludes the passkeys the admin already has', async () => {
    const admin = await signedInAdmin();
    const first = await registerPasskey(admin.cookie);
    const options = await registrationOptions(admin.cookie);
    expect(options.excludeCredentials?.map((c) => c.id)).toEqual([first.id]);
  });

  it('a client and a signed-out visitor cannot use any passkey route', async () => {
    const client = await createUser('client');
    const cookie = await loginAs(app, client.email);
    for (const [method, url] of [
      ['GET', '/api/me/passkeys'],
      ['POST', '/api/me/passkeys/options'],
      ['POST', '/api/me/passkeys/reauth'],
      ['POST', '/api/me/passkeys'],
      ['DELETE', `/api/me/passkeys/${randomUUID()}`],
    ] as const) {
      const asClient = await app.inject({ method, url, headers: { cookie }, payload: {} });
      expect(asClient.statusCode, `${method} ${url}`).toBe(403);
      const anonymous = await app.inject({ method, url, payload: {} });
      expect(anonymous.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('a stale session needs the emailed code, which works once', async () => {
    const admin = await signedInAdmin();
    await makeStale(admin.id);

    const refused = await post('/api/me/passkeys/options', {}, admin.cookie);
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toEqual({ error: 'reauth_required' });

    expect((await post('/api/me/passkeys/reauth', {}, admin.cookie)).statusCode).toBe(204);
    const mail = await emailWithSubject(admin.email, /passkey/);
    const code = loginCodeIn(admin.email, mail.text);
    const wrong = code === '000000' ? '111111' : '000000';

    const bad = await post('/api/me/passkeys/options', { code: wrong }, admin.cookie);
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'invalid_code' });

    const options = await registrationOptions(admin.cookie, { code });
    const { response } = createPasskey(options);
    expect(
      (await post('/api/me/passkeys', { name: 'Phone', response }, admin.cookie)).statusCode,
    ).toBe(201);

    const again = await post('/api/me/passkeys/options', { code }, admin.cookie);
    expect(again.statusCode).toBe(400);
  });

  it('the re-check code allows 3 tries', async () => {
    const admin = await signedInAdmin();
    await makeStale(admin.id);
    await post('/api/me/passkeys/reauth', {}, admin.cookie);
    const code = loginCodeIn(admin.email, (await emailWithSubject(admin.email, /passkey/)).text);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i += 1) {
      expect(
        (await post('/api/me/passkeys/options', { code: wrong }, admin.cookie)).statusCode,
      ).toBe(400);
    }
    expect((await post('/api/me/passkeys/options', { code }, admin.cookie)).statusCode).toBe(400);
  });

  it('the registration challenge is single use and tied to the admin', async () => {
    const admin = await signedInAdmin();
    const other = await signedInAdmin();
    const { response } = createPasskey(await registrationOptions(admin.cookie));

    // Another admin cannot finish it.
    const stolen = await post('/api/me/passkeys', { name: 'X', response }, other.cookie);
    expect(stolen.statusCode).toBe(400);
    expect(stolen.json()).toEqual({ error: 'passkey_invalid' });

    expect((await post('/api/me/passkeys', { name: 'A', response }, admin.cookie)).statusCode).toBe(
      201,
    );
    const replay = await post('/api/me/passkeys', { name: 'B', response }, admin.cookie);
    expect(replay.statusCode).toBe(400);
  });

  it('refuses an expired challenge', async () => {
    const admin = await signedInAdmin();
    const options = await registrationOptions(admin.cookie);
    await test.deps.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(like(verification.identifier, `passkey-register:${admin.id}`));
    const { response } = createPasskey(options);
    expect((await post('/api/me/passkeys', { name: 'A', response }, admin.cookie)).statusCode).toBe(
      400,
    );
  });

  it('refuses another origin, another RP ID and a passkey without user verification', async () => {
    const admin = await signedInAdmin();
    for (const ceremony of [
      { origin: 'https://evil.example' },
      { rpId: 'evil.example' },
      { userVerified: false },
    ]) {
      const { response } = createPasskey(await registrationOptions(admin.cookie), ceremony);
      const res = await post('/api/me/passkeys', { name: 'A', response }, admin.cookie);
      expect(res.statusCode, JSON.stringify(ceremony)).toBe(400);
    }
    const list = await app.inject({
      method: 'GET',
      url: '/api/me/passkeys',
      headers: { cookie: admin.cookie },
    });
    expect(list.json()).toEqual([]);
  });

  it('validates the name', async () => {
    const admin = await signedInAdmin();
    const { response } = createPasskey(await registrationOptions(admin.cookie));
    for (const name of ['', '   ', 'x'.repeat(PASSKEY_LIMITS.name + 1)]) {
      expect((await post('/api/me/passkeys', { name, response }, admin.cookie)).statusCode).toBe(
        400,
      );
    }
  });

  it(`allows at most ${PASSKEY_LIMITS.perUser} passkeys`, async () => {
    const admin = await signedInAdmin();
    await test.deps.db.insert(passkeys).values(
      Array.from({ length: PASSKEY_LIMITS.perUser }, (_, i) => ({
        id: randomUUID(),
        userId: admin.id,
        name: `Key ${i}`,
        credentialId: randomUUID(),
        publicKey: 'AA',
        webauthnUserId: 'AA',
        deviceType: 'multiDevice',
      })),
    );
    const res = await post('/api/me/passkeys/options', {}, admin.cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'passkey_limit' });
  });

  it("deletes only the admin's own passkeys", async () => {
    const owner = await signedInAdmin();
    const other = await signedInAdmin();
    await registerPasskey(owner.cookie);
    const [row] = await test.deps.db.select().from(passkeys).where(eq(passkeys.userId, owner.id));
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/me/passkeys/${row!.id}`,
      headers: { cookie: other.cookie },
    });
    expect(res.statusCode).toBe(404);
    expect(await test.deps.db.select().from(passkeys).where(eq(passkeys.id, row!.id))).toHaveLength(
      1,
    );
  });

  it('refuses a cross-site request (the CSRF guard)', async () => {
    const admin = await signedInAdmin();
    const res = await post('/api/me/passkeys/options', {}, admin.cookie, {
      origin: 'https://evil.example',
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('passkey login', () => {
  it('signs an admin in with a discoverable passkey and notes the use', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);

    const options = await loginOptions();
    expect(options.rpId).toBe('localhost');
    expect(options.userVerification).toBe('required');
    expect(options.allowCredentials ?? []).toEqual([]);

    const res = await passkeySignIn(signInWithPasskey(options, passkey));
    expect(res.statusCode).toBe(200);
    const cookie = cookieHeader(res);
    expect(String(res.headers['set-cookie'])).toContain('HttpOnly');

    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect(MeSchema.parse(me.json())).toMatchObject({ id: admin.id, role: 'admin' });

    const [row] = await test.deps.db
      .select()
      .from(passkeys)
      .where(eq(passkeys.credentialId, passkey.id));
    expect(row!.lastUsedAt).not.toBeNull();
  });

  it('the login challenge is single use', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);
    const response = signInWithPasskey(await loginOptions(), passkey);
    expect((await passkeySignIn(response)).statusCode).toBe(200);
    const replay = await passkeySignIn(response);
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toMatchObject({ code: 'PASSKEY_INVALID' });
  });

  it('refuses a challenge the server never gave and an expired one', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);
    const made = await loginOptions();
    const forged = { ...made, challenge: 'bm90LWEtcmVhbC1jaGFsbGVuZ2U' };
    expect((await passkeySignIn(signInWithPasskey(forged, passkey))).statusCode).toBe(400);

    await test.deps.db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(verification.identifier, `passkey-login:${made.challenge}`));
    expect((await passkeySignIn(signInWithPasskey(made, passkey))).statusCode).toBe(400);
  });

  it('refuses an unknown passkey, another origin or RP ID, no user verification and a wrong user handle', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);
    const unknown = createPasskey(await registrationOptions(admin.cookie)).passkey; // never finished
    let lastOptions: PublicKeyCredentialRequestOptionsJSON;
    const cases = [
      () => signInWithPasskey(lastOptions, unknown),
      () => signInWithPasskey(lastOptions, passkey, { origin: 'https://evil.example' }),
      () => signInWithPasskey(lastOptions, passkey, { rpId: 'evil.example' }),
      () => signInWithPasskey(lastOptions, passkey, { userVerified: false }),
      () => signInWithPasskey(lastOptions, passkey, { userHandle: 'AAAA' }),
    ];
    for (const [i, make] of cases.entries()) {
      lastOptions = await loginOptions();
      const res = await passkeySignIn(make());
      expect(res.statusCode, `case ${i}`).toBe(400);
      expect(res.json(), `case ${i}`).toMatchObject({ code: 'PASSKEY_INVALID' });
      expect(res.headers['set-cookie'], `case ${i}`).toBeUndefined();
    }
  });

  it('refuses a signature counter that went backwards', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);
    expect(
      (await passkeySignIn(signInWithPasskey(await loginOptions(), passkey, { counter: 5 })))
        .statusCode,
    ).toBe(200);
    expect(
      (await passkeySignIn(signInWithPasskey(await loginOptions(), passkey, { counter: 5 })))
        .statusCode,
    ).toBe(400);
    expect(
      (await passkeySignIn(signInWithPasskey(await loginOptions(), passkey, { counter: 3 })))
        .statusCode,
    ).toBe(400);
    expect(
      (await passkeySignIn(signInWithPasskey(await loginOptions(), passkey, { counter: 6 })))
        .statusCode,
    ).toBe(200);
  });

  it('a user who is no longer an admin cannot use their passkey', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);
    await test.deps.db.update(user).set({ role: 'client' }).where(eq(user.id, admin.id));
    const res = await passkeySignIn(signInWithPasskey(await loginOptions(), passkey));
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'PASSKEY_INVALID' });
  });

  it('a removed admin cannot use a passkey, and removal deletes them', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);
    await test.deps.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, admin.id));
    expect((await passkeySignIn(signInWithPasskey(await loginOptions(), passkey))).statusCode).toBe(
      400,
    );

    await deactivateUser(test.deps.db, admin.id);
    expect(await test.deps.db.select().from(passkeys).where(eq(passkeys.userId, admin.id))).toEqual(
      [],
    );
  });

  it('refuses a sign-in from another origin (as every auth route)', async () => {
    const admin = await signedInAdmin();
    const passkey = await registerPasskey(admin.cookie);
    const res = await post(
      '/api/auth/passkey/sign-in',
      { response: signInWithPasskey(await loginOptions(), passkey) },
      admin.cookie,
      { origin: 'https://evil.example' },
    );
    expect(res.statusCode).toBe(403);
  });
});

describe('passkey login rate limits', () => {
  // Production mode turns better-auth's own limits on (the email code's), as in e2e.
  it('passkey requests never use up the email code budget of the address, nor the reverse', async () => {
    const limited = await buildTestApp({
      config: { nodeEnv: 'production', loginCodesPerMinute: 2 },
    });
    try {
      const inject = (url: string, payload: object) =>
        limited.app.inject({ method: 'POST', url, payload });
      // Use up the passkey buckets of 127.0.0.1: options (6 × 2) and sign-ins (2).
      for (let i = 0; i < 12; i += 1) {
        expect((await inject('/api/auth/passkey/options', {})).statusCode).toBe(200);
      }
      expect((await inject('/api/auth/passkey/options', {})).statusCode).toBe(429);
      const badAnswer = { response: { id: 'x', type: 'public-key' } };
      for (let i = 0; i < 2; i += 1) {
        expect((await inject('/api/auth/passkey/sign-in', badAnswer)).statusCode).toBe(400);
      }
      expect((await inject('/api/auth/passkey/sign-in', badAnswer)).statusCode).toBe(429);

      // The email code from the same address is unaffected: sent and usable.
      const id = randomUUID();
      const email = `${id}@example.com`;
      await limited.deps.db
        .insert(user)
        .values({ id, email, name: `User ${id}`, role: 'admin', emailVerified: true });
      expect((await requestCode(limited.app, email)).statusCode).toBe(200);
      const signedIn = await signIn(limited.app, email, await latestLoginCode(email));
      expect(signedIn.statusCode).toBe(200);

      // The reverse, from another address: its code requests used up, its passkey options work.
      // (better-auth keeps its counts per process, so a fresh address, not a fresh app.)
      const remoteAddress = '192.0.2.7';
      const fromOther = (url: string, payload: object) =>
        limited.app.inject({ method: 'POST', url, payload, remoteAddress });
      const unknown = `${randomUUID()}@example.com`; // 200 and no email, but counted
      const statuses: number[] = [];
      for (let i = 0; i < 3; i += 1) {
        const sent = await fromOther('/api/auth/email-otp/send-verification-otp', {
          email: unknown,
          type: 'sign-in',
        });
        statuses.push(sent.statusCode);
      }
      expect(statuses).toEqual([200, 200, 429]);
      expect((await fromOther('/api/auth/passkey/options', {})).statusCode).toBe(200);
    } finally {
      await limited.app.close();
      await limited.close();
    }
  });

  it('limits the options and the sign-in per address', async () => {
    const limited = await buildTestApp({ config: { loginCodesPerMinute: 1 } });
    try {
      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) {
        statuses.push(
          (
            await limited.app.inject({
              method: 'POST',
              url: '/api/auth/passkey/options',
              payload: {},
            })
          ).statusCode,
        );
      }
      expect(statuses.slice(0, 6)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(statuses[6]).toBe(429);

      const signIns: number[] = [];
      for (let i = 0; i < 2; i += 1) {
        signIns.push(
          (
            await limited.app.inject({
              method: 'POST',
              url: '/api/auth/passkey/sign-in',
              payload: { response: { id: 'x', type: 'public-key' } },
            })
          ).statusCode,
        );
      }
      expect(signIns).toEqual([400, 429]);
    } finally {
      await limited.app.close();
      await limited.close();
    }
  });
});
