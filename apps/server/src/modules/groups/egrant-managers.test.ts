import { randomUUID } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { countEmailsTo, latestEmail } from '../../../test/mailpit.js';
import { user } from '../users/schema.js';
import {
  addAdmin,
  createRequesterAccount,
  createUnverifiedClient,
  deactivateUser,
  findUserByEmail,
  setUserLanguage,
} from '../users/service.js';
import { addManager } from './managers.js';
import { addMembership, getMembership } from './memberships.js';
import { groupManagers } from './schema.js';
import { createGroup } from './service.js';

const KEY = 'test-egrant-managers-key-0123';
const URL_PATH = '/api/egrant/managers';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `m${randomUUID().replaceAll('-', '').slice(0, 20)}`;
/** Gives a wrongly sent extra email the time to arrive before counting. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('eGrant managers webhook (a client person of the client group)', () => {
  let test: TestApp;
  const admins: string[] = [];
  let ip = 0;
  const lines: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({
      config: { ticketsApiKey: KEY },
      logStream: { write: (line) => void lines.push(line) },
    });
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const hook = (
    payload: object | string,
    key: string | null = KEY,
    from = `10.2.0.${++ip % 250}`,
  ) =>
    test.app.inject({
      method: 'PUT',
      url: URL_PATH,
      remoteAddress: from,
      headers: {
        ...(key === null ? {} : { authorization: `Bearer ${key}` }),
        'content-type': 'application/json',
      },
      payload,
    });

  async function group(name = 'Mesto X') {
    const h = host();
    const g = await createGroup(db(), { name, egrantUrl: `https://${h}.egrant.sk` });
    return { ...g, host: h, url: `https://${h}.egrant.sk` };
  }
  async function admin(name = 'Eva Admin') {
    const a = await addAdmin(db(), { email: newEmail(), name });
    admins.push(a.id);
    return a;
  }
  async function verifiedClient(name = 'Jana Klientka') {
    const c = await createUnverifiedClient(db(), newEmail(), name);
    await db().update(user).set({ emailVerified: true }).where(eq(user.id, c.id));
    return c;
  }
  const userRow = async (id: string) => (await db().select().from(user).where(eq(user.id, id)))[0]!;
  /** Rows of `group_managers` for the group or the user: the webhook must never write any. */
  const managerRows = (groupId: string, userId: string) =>
    db()
      .select()
      .from(groupManagers)
      .where(or(eq(groupManagers.groupId, groupId), eq(groupManagers.userId, userId)));

  describe('auth', () => {
    it('without the key or with a wrong one is 401; nothing changes', async () => {
      const g = await group();
      const email = newEmail();
      const body = { instance_url: g.url, email, active: true };
      const missing = await hook(body, null);
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({ error: 'unauthorized' });
      expect((await hook(body, 'wrong-key-wrong-key-wrong')).statusCode).toBe(401);
      expect((await hook(body, `${KEY}x`)).statusCode).toBe(401);
      expect(await findUserByEmail(db(), email)).toBeNull();
    });

    it('with no key configured is 503', async () => {
      const off = await buildTestApp();
      try {
        const res = await off.app.inject({
          method: 'PUT',
          url: URL_PATH,
          headers: { authorization: `Bearer ${KEY}` },
          payload: { instance_url: 'https://x.egrant.sk', email: 'a@b.sk', active: true },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'intake_disabled' });
      } finally {
        await off.app.close();
        await off.close();
      }
    });

    it('checks the key before the body: a broken or oversized body without the key is 401', async () => {
      expect((await hook('{not json', null)).statusCode).toBe(401);
      expect((await hook({ junk: 'x'.repeat(64 * 1024) }, null)).statusCode).toBe(401);
      // With the key, the same bodies are refused for what they are.
      expect((await hook('{not json')).statusCode).toBe(400);
      expect((await hook({ junk: 'x'.repeat(64 * 1024) })).statusCode).toBe(413);
    });

    it('the 61st request in a minute from one address is 429', async () => {
      const from = '10.2.9.9';
      const body = { instance_url: 'https://nobody.example.org', email: 'a@b.sk', active: true };
      for (let i = 0; i < 60; i++) expect((await hook(body, KEY, from)).statusCode).toBe(404);
      const res = await hook(body, KEY, from);
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'rate_limited' });
      // Another address is not limited.
      expect((await hook(body, KEY, '10.2.9.10')).statusCode).toBe(404);
    });
  });

  describe('validation', () => {
    it('a malformed body is 400 naming the fields', async () => {
      const res = await hook({ instance_url: '', email: 'not-an-email', active: 'yes', name: 7 });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'validation_failed',
        fields: ['instance_url', 'email', 'active', 'name'],
      });
    });
  });

  describe('instance', () => {
    it('an unknown instance is 404 unknown_instance and creates no account', async () => {
      const email = newEmail();
      const res = await hook({ instance_url: `https://${host()}.egrant.sk`, email, active: true });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'unknown_instance' });
      expect(await findUserByEmail(db(), email)).toBeNull();
    });

    it('matches by host, like the ticket intake: a bare host or any URL of the instance', async () => {
      const g = await group();
      const email = newEmail();
      const bare = await hook({ instance_url: `WWW.${g.host}.egrant.sk`, email, active: true });
      expect(bare.statusCode).toBe(200);
      expect(bare.json()).toMatchObject({ state: 'created', group_id: g.id });
      const deep = await hook({
        instance_url: `http://${g.host.toUpperCase()}.egrant.sk/app/login?x=1`,
        email,
        active: true,
      });
      expect(deep.json()).toMatchObject({ state: 'unchanged', group_id: g.id });
    });
  });

  describe('active: true', () => {
    it('creates a client account with the name, makes it a member, mails one invite; a repeat is unchanged', async () => {
      const g = await group('Mesto Pezinok');
      const email = newEmail();
      const res = await hook({
        instance_url: g.url,
        email: `  ${email.toUpperCase()} `,
        active: true,
        name: '  Jana Nová ',
      });
      expect(res.statusCode).toBe(200);
      const created = await findUserByEmail(db(), email);
      expect(created).not.toBeNull();
      expect(res.json()).toEqual({ state: 'created', group_id: g.id, user_id: created!.id });
      expect(created!.role).toBe('client');
      expect(created!.name).toBe('Jana Nová');
      expect(created!.emailVerified).toBe(false);
      expect(created!.disabledAt).toBeNull();
      expect(await getMembership(db(), created!.id, g.id)).toMatchObject({
        role: 'client',
        removedAt: null,
      });

      // The in-app invite email, in the account's language (sk by default), with the login link.
      const mail = await latestEmail(email);
      expect(mail.subject).toContain('Mesto Pezinok');
      expect(mail.text).toContain('eGrant');
      expect(mail.text).toContain(`/login?email=${encodeURIComponent(email)}`);

      const again = await hook({ instance_url: g.url, email, active: true, name: 'Iné Meno' });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ state: 'unchanged', group_id: g.id, user_id: created!.id });
      await settle();
      expect(await countEmailsTo(email)).toBe(1);
      expect((await userRow(created!.id)).name).toBe('Jana Nová');
      expect(await managerRows(g.id, created!.id)).toEqual([]);
    });

    it('without a name creates the account with an empty one (asked at the first login)', async () => {
      const g = await group();
      const email = newEmail();
      const res = await hook({ instance_url: g.url, email, active: true, name: null });
      expect(res.json()).toMatchObject({ state: 'created' });
      expect((await findUserByEmail(db(), email))?.name).toBe('');
    });

    it('adds an existing signed-in client of another group, mailing "added" in their language', async () => {
      const other = await group('Iný klient');
      const g = await group('Mesto Senec');
      const c = await verifiedClient('Jana Pôvodná');
      await setUserLanguage(db(), c.id, 'en');
      await addMembership(db(), c.id, other.id, 'client');
      const res = await hook({ instance_url: g.url, email: c.email, active: true, name: 'X Y' });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: 'added', group_id: g.id, user_id: c.id });
      expect(await getMembership(db(), c.id, g.id)).toMatchObject({ role: 'client' });
      expect(await getMembership(db(), c.id, other.id)).toMatchObject({ removedAt: null });
      // An invite never renames someone.
      expect((await userRow(c.id)).name).toBe('Jana Pôvodná');
      const mail = await latestEmail(c.email);
      expect(mail.subject).toBe('You were added to Mesto Senec');
      expect(mail.text).toContain('eGrant added you');
      expect(mail.text).toContain(`/groups/${g.id}`);
      await settle();
      expect(await countEmailsTo(c.email)).toBe(1);
    });

    it('a requester (ziadatel) of the group becomes its client', async () => {
      const g = await group();
      const r = await createRequesterAccount(db(), { email: newEmail(), name: 'Peter' });
      await addMembership(db(), r.id, g.id, 'ziadatel');
      const res = await hook({ instance_url: g.url, email: r.email, active: true });
      expect(res.json()).toEqual({ state: 'added', group_id: g.id, user_id: r.id });
      expect(await getMembership(db(), r.id, g.id)).toMatchObject({ role: 'client' });
      expect((await latestEmail(r.email)).text).toContain('eGrant');
      await settle();
      expect(await countEmailsTo(r.email)).toBe(1);
    });

    it('an existing member is unchanged and gets no email', async () => {
      const g = await group();
      const c = await verifiedClient();
      await addMembership(db(), c.id, g.id, 'client');
      const res = await hook({ instance_url: g.url, email: c.email, active: true });
      expect(res.json()).toEqual({ state: 'unchanged', group_id: g.id, user_id: c.id });
      await settle();
      expect(await countEmailsTo(c.email)).toBe(0);
    });

    it('re-adds a client the webhook removed before', async () => {
      const g = await group();
      const c = await verifiedClient();
      await addMembership(db(), c.id, g.id, 'client');
      expect(
        (await hook({ instance_url: g.url, email: c.email, active: false })).json(),
      ).toMatchObject({ state: 'removed' });
      const res = await hook({ instance_url: g.url, email: c.email, active: true });
      expect(res.json()).toEqual({ state: 'added', group_id: g.id, user_id: c.id });
      expect(await getMembership(db(), c.id, g.id)).toMatchObject({ removedAt: null });
      expect((await latestEmail(c.email)).text).toContain(`/groups/${g.id}`);
    });

    it("an admin's or the superadmin's email is 422 email_is_admin and nothing changes", async () => {
      const g = await group();
      const a = await admin();
      const s = await admin('Super Admin');
      await db().update(user).set({ role: 'superadmin' }).where(eq(user.id, s.id));
      for (const account of [a, s]) {
        for (const active of [true, false]) {
          const res = await hook({ instance_url: g.url, email: account.email, active });
          expect(res.statusCode).toBe(422);
          expect(res.json()).toEqual({ error: 'email_is_admin' });
        }
        const row = await userRow(account.id);
        expect(row.role).not.toBe('client');
        expect(row.disabledAt).toBeNull();
        expect(await getMembership(db(), account.id, g.id)).toBeNull();
        expect(await managerRows(g.id, account.id)).toEqual([]);
      }
      await settle();
      expect(await countEmailsTo(a.email)).toBe(0);
    });

    it('a disabled user is 422 user_disabled: not re-enabled, not added', async () => {
      const g = await group();
      const c = await verifiedClient();
      await deactivateUser(db(), c.id);
      const res = await hook({ instance_url: g.url, email: c.email, active: true });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'user_disabled' });
      expect((await userRow(c.id)).disabledAt).not.toBeNull();
      expect(await getMembership(db(), c.id, g.id)).toBeNull();
      await settle();
      expect(await countEmailsTo(c.email)).toBe(0);
    });

    it('never touches the managers: an existing manager of the group stays, nobody is added', async () => {
      const g = await group();
      const a = await admin();
      await addManager(db(), g.id, a.id);
      const res = await hook({ instance_url: g.url, email: newEmail(), active: true });
      const { user_id } = res.json() as { user_id: string };
      const rows = await managerRows(g.id, user_id);
      expect(rows.map((r) => r.userId)).toEqual([a.id]);
    });

    it('writes a log line without the key or the email', async () => {
      const g = await group();
      const email = newEmail();
      lines.length = 0;
      await hook({ instance_url: g.url, email, active: true });
      const line = lines.find((l) => l.includes('egrant manager'));
      expect(line).toBeDefined();
      expect(line).toContain(g.id);
      expect(lines.join('\n')).not.toContain(KEY);
      expect(lines.join('\n')).not.toContain(email);
    });
  });

  describe('active: false', () => {
    it('removes only that membership, keeps the account active, sends no email; a repeat is unchanged', async () => {
      const g = await group();
      const c = await verifiedClient();
      await addMembership(db(), c.id, g.id, 'client');
      const res = await hook({ instance_url: g.url, email: c.email, active: false });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: 'removed', group_id: g.id, user_id: c.id });
      expect((await getMembership(db(), c.id, g.id))?.removedAt).not.toBeNull();
      // No group left, still not disabled: they simply see nothing (but their own tickets).
      const row = await userRow(c.id);
      expect(row.disabledAt).toBeNull();
      expect(row.role).toBe('client');
      await settle();
      expect(await countEmailsTo(c.email)).toBe(0);

      const again = await hook({ instance_url: g.url, email: c.email, active: false });
      expect(again.json()).toEqual({ state: 'unchanged', group_id: g.id, user_id: c.id });
      expect(await managerRows(g.id, c.id)).toEqual([]);
    });

    it('an unknown email is unchanged with no user and creates nothing', async () => {
      const g = await group();
      const email = newEmail();
      const res = await hook({ instance_url: g.url, email, active: false });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: 'unchanged', group_id: g.id, user_id: null });
      expect(await findUserByEmail(db(), email)).toBeNull();
    });

    it("leaves a requester's (ziadatel) membership alone", async () => {
      const g = await group();
      const r = await createRequesterAccount(db(), { email: newEmail(), name: 'Peter' });
      await addMembership(db(), r.id, g.id, 'ziadatel');
      const res = await hook({ instance_url: g.url, email: r.email, active: false });
      expect(res.json()).toEqual({ state: 'unchanged', group_id: g.id, user_id: r.id });
      expect(await getMembership(db(), r.id, g.id)).toMatchObject({
        role: 'ziadatel',
        removedAt: null,
      });
    });

    it('a disabled client can still be removed and stays disabled', async () => {
      const g = await group();
      const c = await verifiedClient();
      await addMembership(db(), c.id, g.id, 'client');
      await deactivateUser(db(), c.id);
      const res = await hook({ instance_url: g.url, email: c.email, active: false });
      expect(res.json()).toMatchObject({ state: 'removed' });
      expect((await userRow(c.id)).disabledAt).not.toBeNull();
    });
  });

  it('cross-client: only the matched client changes', async () => {
    const g1 = await group('Klient 1');
    const g2 = await group('Klient 2');
    const c = await verifiedClient();
    await addMembership(db(), c.id, g2.id, 'client');
    await hook({ instance_url: g1.url, email: c.email, active: true });
    expect(await getMembership(db(), c.id, g1.id)).toMatchObject({ removedAt: null });
    expect(await getMembership(db(), c.id, g2.id)).toMatchObject({ removedAt: null });
    await hook({ instance_url: g2.url, email: c.email, active: false });
    expect(await getMembership(db(), c.id, g1.id)).toMatchObject({ removedAt: null });
    expect((await getMembership(db(), c.id, g2.id))?.removedAt).not.toBeNull();
    expect(await managerRows(g1.id, c.id)).toEqual([]);
    expect(await managerRows(g2.id, c.id)).toEqual([]);
  });
});
