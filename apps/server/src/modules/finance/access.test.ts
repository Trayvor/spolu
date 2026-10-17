import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { FinanceEvents, type Admin, type Me } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { userRoom } from '../../infra/realtime/rooms.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { requireFinance } from './access.js';
import { FINANCE_ROOM } from './events.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;

describe('finance access', () => {
  let test: TestApp;
  let url: string;
  let superCookie: string;
  let superEmail: string;
  const sockets: Socket[] = [];

  const call = (method: 'GET' | 'PUT' | 'DELETE', path: string, cookie?: string) =>
    test.app.inject({ method, url: path, headers: cookie ? { cookie } : {} });
  const grant = (id: string, cookie = superCookie) =>
    call('PUT', `/api/admins/${id}/finance-access`, cookie);
  const revoke = (id: string, cookie = superCookie) =>
    call('DELETE', `/api/admins/${id}/finance-access`, cookie);
  const me = async (cookie: string) => (await call('GET', '/api/me', cookie)).json<Me>();

  async function adminSession(name = 'Fin Admin') {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name });
    return { id: admin.id, email, cookie: await loginAs(test.app, email) };
  }
  async function clientSession() {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'A Client', role: 'client', emailVerified: true });
    return { id, email, cookie: await loginAs(test.app, email) };
  }
  async function connected(cookie: string): Promise<Socket> {
    const socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }
  const inFinanceRoom = async (userId: string) =>
    (await test.app.io.in(FINANCE_ROOM).fetchSockets()).some((s) => s.data.user.id === userId);
  const settle = () => new Promise((r) => setTimeout(r, 150));

  beforeAll(async () => {
    test = await buildTestApp();
    // A superadmin of this file's own (the configured one is shared with other test files,
    // whose logins would race this one's for the same address's codes).
    superEmail = newEmail();
    const boss = await addAdmin(test.deps.db, { email: superEmail, name: 'Boss' });
    await test.deps.db.update(user).set({ role: 'superadmin' }).where(eq(user.id, boss.id));
    superCookie = await loginAs(test.app, superEmail);
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    // Retire it: later runs and other files must not meet an extra superadmin.
    await test.deps.db
      .update(user)
      .set({ disabledAt: new Date() })
      .where(eq(user.email, superEmail));
    await test.app.close();
    await test.close();
  });

  describe('SessionUser.finance on /api/me', () => {
    it('the superadmin always has it, an admin once granted, a client never', async () => {
      expect((await me(superCookie)).finance).toBe(true);
      const admin = await adminSession();
      expect((await me(admin.cookie)).finance).toBe(false);
      expect((await grant(admin.id)).statusCode).toBe(204);
      // Sessions read the user row on every request: the next request already has it.
      expect((await me(admin.cookie)).finance).toBe(true);
      expect((await revoke(admin.id)).statusCode).toBe(204);
      expect((await me(admin.cookie)).finance).toBe(false);
      const client = await clientSession();
      expect((await me(client.cookie)).finance).toBe(false);
    });
  });

  describe('PUT/DELETE /api/admins/:id/finance-access', () => {
    it('stores who granted it and is idempotent both ways', async () => {
      const admin = await adminSession();
      expect((await grant(admin.id)).statusCode).toBe(204);
      expect((await grant(admin.id)).statusCode).toBe(204);
      const [row] = await test.deps.db.select().from(user).where(eq(user.id, admin.id));
      expect(row!.financeAccessAt).not.toBeNull();
      const [superRow] = await test.deps.db.select().from(user).where(eq(user.email, superEmail));
      expect(row!.financeAccessBy).toBe(superRow!.id);
      expect((await revoke(admin.id)).statusCode).toBe(204);
      expect((await revoke(admin.id)).statusCode).toBe(204);
      const [after] = await test.deps.db.select().from(user).where(eq(user.id, admin.id));
      expect(after!.financeAccessAt).toBeNull();
      expect(after!.financeAccessBy).toBeNull();
    });

    it('only the superadmin: a finance admin, an admin and a client get 403, anonymous 401', async () => {
      const target = await adminSession();
      const financeAdmin = await adminSession();
      await grant(financeAdmin.id);
      const admin = await adminSession();
      const client = await clientSession();
      for (const cookie of [financeAdmin.cookie, admin.cookie, client.cookie]) {
        expect((await grant(target.id, cookie)).statusCode).toBe(403);
        expect((await revoke(target.id, cookie)).statusCode).toBe(403);
      }
      expect((await call('PUT', `/api/admins/${target.id}/finance-access`)).statusCode).toBe(401);
      expect((await me(target.cookie)).finance).toBe(false);
    });

    it('404 for a client, an unknown id, a disabled admin and the superadmin', async () => {
      const client = await clientSession();
      const gone = await adminSession();
      await call('DELETE', `/api/admins/${gone.id}`, superCookie);
      const superId = (await me(superCookie)).id;
      for (const id of [client.id, randomUUID(), gone.id, superId]) {
        expect((await grant(id)).statusCode).toBe(404);
        expect((await revoke(id)).statusCode).toBe(404);
      }
      const [row] = await test.deps.db.select().from(user).where(eq(user.id, client.id));
      expect(row!.financeAccessAt).toBeNull();
    });

    it("moves the admin's sockets into and out of the finance room and pushes me:changed", async () => {
      const admin = await adminSession();
      const socket = await connected(admin.cookie);
      expect(await inFinanceRoom(admin.id)).toBe(false);
      const changed: unknown[] = [];
      socket.on(FinanceEvents.meChanged, (payload: unknown) => changed.push(payload));

      await grant(admin.id);
      await settle();
      expect(await inFinanceRoom(admin.id)).toBe(true);
      const [joined] = await test.app.io.in(userRoom(admin.id)).fetchSockets();
      expect(joined!.data.user.finance).toBe(true);
      expect(changed).toEqual([{}]);

      await revoke(admin.id);
      await settle();
      expect(await inFinanceRoom(admin.id)).toBe(false);
      const [left] = await test.app.io.in(userRoom(admin.id)).fetchSockets();
      expect(left!.data.user.finance).toBe(false);
      expect(changed).toEqual([{}, {}]);
    });

    it('an idempotent repeat pushes nothing', async () => {
      const admin = await adminSession();
      const socket = await connected(admin.cookie);
      const changed: unknown[] = [];
      socket.on(FinanceEvents.meChanged, (payload: unknown) => changed.push(payload));
      await revoke(admin.id); // never had it
      await grant(admin.id);
      await grant(admin.id);
      await settle();
      expect(changed).toHaveLength(1);
    });
  });

  describe('the finance room on connect', () => {
    it('the superadmin and a finance admin join it; an admin and a client do not', async () => {
      const financeAdmin = await adminSession();
      await grant(financeAdmin.id);
      const admin = await adminSession();
      const client = await clientSession();
      await connected(superCookie);
      await connected(financeAdmin.cookie);
      await connected(admin.cookie);
      await connected(client.cookie);
      const ids = (await test.app.io.in(FINANCE_ROOM).fetchSockets()).map((s) => s.data.user.id);
      expect(ids).toContain((await me(superCookie)).id);
      expect(ids).toContain(financeAdmin.id);
      expect(ids).not.toContain(admin.id);
      expect(ids).not.toContain(client.id);
    });
  });

  describe('deactivation', () => {
    it('removes the right; reactivating needs a new grant', async () => {
      const admin = await adminSession();
      await grant(admin.id);
      expect((await call('DELETE', `/api/admins/${admin.id}`, superCookie)).statusCode).toBe(204);
      const [row] = await test.deps.db.select().from(user).where(eq(user.id, admin.id));
      expect(row!.financeAccessAt).toBeNull();
      // Added again: an admin without the right.
      await addAdmin(test.deps.db, { email: row!.email, name: 'Back' });
      const cookie = await loginAs(test.app, row!.email);
      expect((await me(cookie)).finance).toBe(false);
    });
  });

  describe('GET /api/admins', () => {
    it('shows the right to the superadmin only', async () => {
      const admin = await adminSession();
      await grant(admin.id);
      const forSuper = (await call('GET', '/api/admins', superCookie)).json<Admin[]>();
      expect(forSuper.find((a) => a.id === admin.id)?.finance).toBe(true);
      expect(forSuper.find((a) => a.role === 'superadmin')?.finance).toBe(true);
      const other = await adminSession();
      const forAdmin = (await call('GET', '/api/admins', other.cookie)).json<Admin[]>();
      expect(forAdmin.find((a) => a.id === admin.id)).not.toHaveProperty('finance');
    });
  });

  describe('requireFinance', () => {
    /** Runs the preHandler on a fake reply; the status it set, or 'passed'. */
    async function check(cookie?: string): Promise<number | 'passed'> {
      let status: number | null = null;
      const reply = {
        code(n: number) {
          status = n;
          return reply;
        },
        send() {
          return reply;
        },
      };
      const request = { headers: cookie ? { cookie } : {}, user: null };
      await requireFinance(test.app.auth).call(test.app, request as never, reply as never);
      return status ?? 'passed';
    }

    it('401 without a session, 403 without the right, passes a finance admin', async () => {
      expect(await check()).toBe(401);
      const admin = await adminSession();
      const client = await clientSession();
      expect(await check(admin.cookie)).toBe(403);
      expect(await check(client.cookie)).toBe(403);
      await grant(admin.id);
      expect(await check(admin.cookie)).toBe('passed');
      expect(await check(superCookie)).toBe('passed');
    });
  });
});
