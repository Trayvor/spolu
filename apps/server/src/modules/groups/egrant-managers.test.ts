import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { countEmailsTo, latestEmail } from '../../../test/mailpit.js';
import { getEffectiveGroupMode } from '../notifications/modes.js';
import { user } from '../users/schema.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  findUserByEmail,
  setUserLanguage,
} from '../users/service.js';
import { addManager, isGroupManager, listGroupManagers } from './managers.js';
import { addMembership } from './memberships.js';
import { createGroup } from './service.js';

const KEY = 'test-egrant-managers-key-0123';
const URL_PATH = '/api/egrant/managers';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `m${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('eGrant managers webhook', () => {
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

  describe('auth', () => {
    it('without the key or with a wrong one is 401; nothing changes', async () => {
      const g = await group();
      const a = await admin();
      const body = { instance_url: g.url, email: a.email, active: true };
      const missing = await hook(body, null);
      expect(missing.statusCode).toBe(401);
      expect(missing.json()).toEqual({ error: 'unauthorized' });
      expect((await hook(body, 'wrong-key-wrong-key-wrong')).statusCode).toBe(401);
      expect((await hook(body, `${KEY}x`)).statusCode).toBe(401);
      expect(await isGroupManager(db(), g.id, a.id)).toBe(false);
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
      const res = await hook({ instance_url: '', email: 'not-an-email', active: 'yes' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: 'validation_failed',
        fields: ['instance_url', 'email', 'active'],
      });
    });
  });

  describe('instance', () => {
    it('an unknown instance is 404 unknown_instance', async () => {
      const a = await admin();
      const res = await hook({
        instance_url: `https://${host()}.egrant.sk`,
        email: a.email,
        active: true,
      });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'unknown_instance' });
    });

    it('matches by host, like the ticket intake: a bare host or any URL of the instance', async () => {
      const g = await group();
      const a = await admin();
      const bare = await hook({
        instance_url: `WWW.${g.host}.egrant.sk`,
        email: a.email,
        active: true,
      });
      expect(bare.statusCode).toBe(200);
      expect(bare.json()).toMatchObject({ state: 'added', group_id: g.id });
      const deep = await hook({
        instance_url: `http://${g.host.toUpperCase()}.egrant.sk/app/login?x=1`,
        email: a.email,
        active: true,
      });
      expect(deep.json()).toMatchObject({ state: 'unchanged', group_id: g.id });
    });
  });

  describe('the security boundary: only an existing active admin', () => {
    it('an unknown email is 422 unknown_admin and creates no account', async () => {
      const g = await group();
      const email = newEmail();
      const res = await hook({ instance_url: g.url, email, active: true });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'unknown_admin' });
      expect(await findUserByEmail(db(), email)).toBeNull();
      expect(await listGroupManagers(db(), g.id)).toEqual([]);
      // Deactivating an unknown email creates nothing either.
      expect((await hook({ instance_url: g.url, email, active: false })).statusCode).toBe(422);
      expect(await findUserByEmail(db(), email)).toBeNull();
    });

    it("a client's email is 422 and the client stays a client", async () => {
      const g = await group();
      const c = await createUnverifiedClient(db(), newEmail());
      await addMembership(db(), c.id, g.id, 'client');
      for (const active of [true, false]) {
        const res = await hook({ instance_url: g.url, email: c.email, active });
        expect(res.statusCode).toBe(422);
        expect(res.json()).toEqual({ error: 'unknown_admin' });
      }
      const [row] = await db().select().from(user).where(eq(user.id, c.id));
      expect(row?.role).toBe('client');
      expect(await isGroupManager(db(), g.id, c.id)).toBe(false);
      expect(await countEmailsTo(c.email)).toBe(0);
    });

    it('a disabled admin cannot be added: 422, the account stays disabled', async () => {
      const g = await group();
      const a = await admin();
      await deactivateUser(db(), a.id);
      const res = await hook({ instance_url: g.url, email: a.email, active: true });
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'unknown_admin' });
      const [row] = await db().select().from(user).where(eq(user.id, a.id));
      expect(row?.disabledAt).not.toBeNull();
      expect(row?.role).toBe('admin');
      expect(await countEmailsTo(a.email)).toBe(0);
    });

    it('the superadmin can be added', async () => {
      const g = await group();
      const s = await admin('Super Admin');
      await db().update(user).set({ role: 'superadmin' }).where(eq(user.id, s.id));
      const res = await hook({ instance_url: g.url, email: s.email, active: true });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'added' });
      expect(await isGroupManager(db(), g.id, s.id)).toBe(true);
    });
  });

  describe('add', () => {
    it('makes the admin a manager, mails them once in their language; a repeat is unchanged', async () => {
      const g = await group('Mesto Pezinok');
      const a = await admin();
      await setUserLanguage(db(), a.id, 'en');
      const res = await hook({
        instance_url: g.url,
        email: `  ${a.email.toUpperCase()} `,
        active: true,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: 'added', group_id: g.id, user_id: a.id });
      expect(await isGroupManager(db(), g.id, a.id)).toBe(true);
      // The groups service's defaults apply: becoming a manager sets All messages.
      const actor = {
        id: a.id,
        email: a.email,
        name: a.name,
        role: 'admin' as const,
        finance: false,
      };
      expect(await getEffectiveGroupMode(db(), actor, g.id)).toBe('all');

      const mail = await latestEmail(a.email);
      expect(mail.subject).toBe('You are now a manager of Mesto Pezinok');
      expect(mail.text).toContain('eGrant');
      expect(mail.text).toContain(`/groups/${g.id}`);

      const again = await hook({ instance_url: g.url, email: a.email, active: true });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual({ state: 'unchanged', group_id: g.id, user_id: a.id });
      // Give a wrongly sent second email the time to arrive before counting.
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await countEmailsTo(a.email)).toBe(1);
    });

    it('an admin who already manages the client by hand gets no email', async () => {
      const g = await group();
      const a = await admin();
      await addManager(db(), g.id, a.id);
      const res = await hook({ instance_url: g.url, email: a.email, active: true });
      expect(res.json()).toMatchObject({ state: 'unchanged' });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await countEmailsTo(a.email)).toBe(0);
    });

    it('writes a log line without the key', async () => {
      const g = await group();
      const a = await admin();
      lines.length = 0;
      await hook({ instance_url: g.url, email: a.email, active: true });
      const line = lines.find((l) => l.includes('egrant manager'));
      expect(line).toBeDefined();
      expect(line).toContain(g.id);
      expect(line).not.toContain(KEY);
    });
  });

  describe('deactivate', () => {
    it('removes the manager, keeps the account active, sends no email; a repeat is unchanged', async () => {
      const g = await group();
      const a = await admin();
      const other = await admin('Other Admin');
      await addManager(db(), g.id, a.id);
      await addManager(db(), g.id, other.id);
      const res = await hook({ instance_url: g.url, email: a.email, active: false });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ state: 'removed', group_id: g.id, user_id: a.id });
      expect(await isGroupManager(db(), g.id, a.id)).toBe(false);
      expect(await isGroupManager(db(), g.id, other.id)).toBe(true);
      const [row] = await db().select().from(user).where(eq(user.id, a.id));
      expect(row?.disabledAt).toBeNull();
      expect(row?.role).toBe('admin');
      expect(await countEmailsTo(a.email)).toBe(0);

      const again = await hook({ instance_url: g.url, email: a.email, active: false });
      expect(again.json()).toEqual({ state: 'unchanged', group_id: g.id, user_id: a.id });
    });

    it('may leave the client with no manager, and logs it', async () => {
      const g = await group();
      const a = await admin();
      await addManager(db(), g.id, a.id);
      lines.length = 0;
      const res = await hook({ instance_url: g.url, email: a.email, active: false });
      expect(res.json()).toMatchObject({ state: 'removed' });
      expect(await listGroupManagers(db(), g.id)).toEqual([]);
      expect(lines.some((l) => l.includes('no manager'))).toBe(true);
    });

    it('a disabled admin can still be removed (their row would count again if re-enabled)', async () => {
      const g = await group();
      const a = await admin();
      await addManager(db(), g.id, a.id);
      await deactivateUser(db(), a.id);
      const res = await hook({ instance_url: g.url, email: a.email, active: false });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'removed' });
      const [row] = await db().select().from(user).where(eq(user.id, a.id));
      expect(row?.disabledAt).not.toBeNull();
    });
  });

  it('cross-client: only the matched client changes', async () => {
    const g1 = await group('Klient 1');
    const g2 = await group('Klient 2');
    const a = await admin();
    await addManager(db(), g2.id, a.id);
    await hook({ instance_url: g1.url, email: a.email, active: true });
    expect(await isGroupManager(db(), g1.id, a.id)).toBe(true);
    expect(await isGroupManager(db(), g2.id, a.id)).toBe(true);
    await hook({ instance_url: g2.url, email: a.email, active: false });
    expect(await isGroupManager(db(), g1.id, a.id)).toBe(true);
    expect(await isGroupManager(db(), g2.id, a.id)).toBe(false);
  });
});
