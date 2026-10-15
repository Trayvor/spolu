import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Me } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { cookieHeader, requestCode, signIn } from '../../../test/login.js';
import { countEmailsTo, latestLoginCode } from '../../../test/mailpit.js';
import { user } from '../users/schema.js';
import { groupMembers } from './schema.js';
import { addAdmin, findUserByEmail } from '../users/service.js';
import { addMember, createGroup, getMembershipGroupId, regenerateInvite } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('join API', () => {
  let test: TestApp;
  let n = 0;

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  /** Each test posts from its own fake IP so the rate limit never leaks between tests. */
  const join = (token: string, payload: unknown, ip = `10.0.0.${++n}`) =>
    test.app.inject({
      method: 'POST',
      url: `/api/join/${token}`,
      remoteAddress: ip,
      payload: payload as object,
    });

  const newGroup = () => createGroup(test.deps.db, { name: 'Join Co', egrantUrl: newUrl() });

  it('GET returns the name and logo flag, 404 for an unknown token', async () => {
    const group = await newGroup();
    const ok = await test.app.inject({ method: 'GET', url: `/api/join/${group.inviteToken}` });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ name: 'Join Co', hasLogo: false });
    const bad = await test.app.inject({ method: 'GET', url: '/api/join/nope' });
    expect(bad.statusCode).toBe(404);
    expect(bad.json()).toEqual({ error: 'not_found' });
  });

  it('a new email creates an unverified client in the group; code, sign-in and listing follow', async () => {
    const group = await newGroup();
    const email = newEmail();
    const res = await join(group.inviteToken, { email: ` ${email.toUpperCase()} ` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const created = await findUserByEmail(test.deps.db, email);
    expect(created).toMatchObject({ role: 'client', name: '', emailVerified: false });
    expect(await getMembershipGroupId(test.deps.db, created!.id)).toBe(group.id);

    expect((await requestCode(test.app, email)).statusCode).toBe(200);
    const signed = await signIn(test.app, email, await latestLoginCode(email));
    expect(signed.statusCode).toBe(200);
    expect((await findUserByEmail(test.deps.db, email))?.emailVerified).toBe(true);

    const cookie = cookieHeader(signed);
    const me = await test.app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    expect((me.json() as Me).role).toBe('client');
    const mine = await test.app.inject({
      method: 'GET',
      url: `/api/groups/${group.id}/members`,
      headers: { cookie },
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json()).toEqual([expect.objectContaining({ email })]);
  });

  it('an admin, a client of another group and a removed client get the same body and nothing changes', async () => {
    const group = await newGroup();
    const other = await newGroup();
    const adminEmail = newEmail();
    await addAdmin(test.deps.db, { email: adminEmail, name: 'Ad Min' });
    const clientEmail = newEmail();
    const removedEmail = newEmail();
    const clientId = randomUUID();
    const removedId = randomUUID();
    await test.deps.db.insert(user).values([
      { id: clientId, email: clientEmail, name: 'C', role: 'client', emailVerified: true },
      {
        id: removedId,
        email: removedEmail,
        name: 'R',
        role: 'client',
        emailVerified: true,
        disabledAt: new Date(),
      },
    ]);
    await addMember(test.deps.db, other.id, clientId);
    await addMember(test.deps.db, group.id, removedId);

    const before = await Promise.all(
      [adminEmail, clientEmail, removedEmail].map((e) => findUserByEmail(test.deps.db, e)),
    );
    const fresh = await join(group.inviteToken, { email: newEmail() });
    for (const email of [adminEmail, clientEmail, removedEmail]) {
      const res = await join(group.inviteToken, { email });
      expect(res.statusCode).toBe(200);
      expect(res.body).toBe(fresh.body);
    }
    const after = await Promise.all(
      [adminEmail, clientEmail, removedEmail].map((e) => findUserByEmail(test.deps.db, e)),
    );
    expect(after).toEqual(before);
    expect(await getMembershipGroupId(test.deps.db, clientId)).toBe(other.id);
    expect(await getMembershipGroupId(test.deps.db, before[0]!.id)).toBeNull();
  });

  it('a removed client gets no code after join', async () => {
    const group = await newGroup();
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db.insert(user).values({
      id,
      email,
      name: 'R',
      role: 'client',
      emailVerified: true,
      disabledAt: new Date(),
    });
    await addMember(test.deps.db, group.id, id);
    expect((await join(group.inviteToken, { email })).statusCode).toBe(200);
    await requestCode(test.app, email);
    expect(await countEmailsTo(email)).toBe(0);
    expect((await findUserByEmail(test.deps.db, email))?.disabledAt).not.toBeNull();
    await test.deps.db.delete(user).where(eq(user.id, id));
  });

  it('an old token is 404 (before the email is checked), the new one works; bad email is 400', async () => {
    const group = await newGroup();
    const old = group.inviteToken;
    const fresh = await regenerateInvite(test.deps.db, group.id);
    const email = newEmail();
    const gone = await join(old, { email });
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ error: 'not_found' });
    expect((await join(old, { email: 'nope' })).statusCode).toBe(404);
    expect(await findUserByEmail(test.deps.db, email)).toBeNull();
    const bad = await join(fresh, { email: 'nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'validation_failed' });
    expect((await join(fresh, { email })).statusCode).toBe(200);
  });

  it('the 11th join in a minute from one IP is 429', async () => {
    const group = await newGroup();
    const ip = '10.9.9.9';
    for (let i = 0; i < 10; i++) {
      expect((await join(group.inviteToken, { email: newEmail() }, ip)).statusCode).toBe(200);
    }
    const res = await join(group.inviteToken, { email: newEmail() }, ip);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });

  it('an unverified client follows the latest invite; a verified client stays', async () => {
    const a = await newGroup();
    const b = await newGroup();
    const email = newEmail();
    await join(a.inviteToken, { email });
    await join(b.inviteToken, { email });
    const moved = await findUserByEmail(test.deps.db, email);
    expect(await getMembershipGroupId(test.deps.db, moved!.id)).toBe(b.id);
    const rows = await test.deps.db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.userId, moved!.id));
    expect(rows).toHaveLength(1);

    const verifiedEmail = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email: verifiedEmail, name: 'V', role: 'client', emailVerified: true });
    await addMember(test.deps.db, a.id, id);
    await join(b.inviteToken, { email: verifiedEmail });
    expect(await getMembershipGroupId(test.deps.db, id)).toBe(a.id);
  });

  it('two parallel joins with the same new email both answer 200 and make one user and membership', async () => {
    const group = await newGroup();
    const email = newEmail();
    const [r1, r2] = await Promise.all([
      join(group.inviteToken, { email }),
      join(group.inviteToken, { email }),
    ]);
    expect([r1.statusCode, r2.statusCode]).toEqual([200, 200]);
    const users = await test.deps.db.select().from(user).where(eq(user.email, email));
    expect(users).toHaveLength(1);
    const rows = await test.deps.db
      .select()
      .from(groupMembers)
      .where(eq(groupMembers.userId, users[0]!.id));
    expect(rows).toHaveLength(1);
  });
});
