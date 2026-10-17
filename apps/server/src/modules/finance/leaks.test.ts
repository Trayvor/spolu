import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { FinanceEvents, type FileInfo } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { ensureGroupChannel } from '../chat/service.js';
import { setFilesFinanceOnly } from '../files/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, setFinanceAccess } from '../users/service.js';
import { emitFinanceChanged } from './events.js';

/**
 * The leak guarantees of part A1 (spec §2.3): a finance file opens only for finance admins, no
 * other module attaches it, finance events stay in the finance room, the Finance notification
 * group belongs to finance admins only.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;

describe('finance leak guarantees (A1)', () => {
  let test: TestApp;
  let url: string;
  let superId: string;
  const sockets: Socket[] = [];

  const call = (method: 'GET' | 'POST' | 'PATCH', path: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url: path, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminSession(finance: boolean) {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: finance ? 'Fin' : 'Plain' });
    if (finance) await setFinanceAccess(test.deps.db, admin.id, superId);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  async function clientIn(groupId: string) {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Client', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }
  const newGroup = () =>
    createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
  const upload = async (groupId: string, cookie: string) =>
    (
      await test.app.inject({
        method: 'POST',
        url: `/api/groups/${groupId}/files`,
        headers: { cookie, 'content-type': 'text/plain', 'x-file-name': 'contract.txt' },
        payload: Buffer.from('12 000 EUR'),
      })
    ).json<FileInfo>();
  /** A finance-only file of the group, uploaded by `cookie`'s user. */
  const financeFile = async (groupId: string, cookie: string) => {
    const file = await upload(groupId, cookie);
    await setFilesFinanceOnly(test.deps.db, [file.id]);
    return file;
  };
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

  beforeAll(async () => {
    test = await buildTestApp();
    // Who granted the right only fills `finance_access_by`: any admin will do.
    superId = (await addAdmin(test.deps.db, { email: newEmail(), name: 'Granter' })).id;
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  describe('a finance-only file', () => {
    it("opens for a finance admin only: 404 for the group's client and another admin, even with its id", async () => {
      const g = await newGroup();
      const finance = await adminSession(true);
      const other = await adminSession(false);
      const client = await clientIn(g.id);
      const file = await financeFile(g.id, finance.cookie);
      expect((await call('GET', `/api/files/${file.id}`, finance.cookie)).statusCode).toBe(200);
      for (const cookie of [other.cookie, client.cookie]) {
        expect((await call('GET', `/api/files/${file.id}`, cookie)).statusCode).toBe(404);
        expect((await call('GET', `/api/files/${file.id}/preview`, cookie)).statusCode).toBe(404);
      }
    });

    it('cannot be sent in a chat message, even by the finance admin who uploaded it', async () => {
      const g = await newGroup();
      const finance = await adminSession(true);
      const file = await financeFile(g.id, finance.cookie);
      const channel = await ensureGroupChannel(test.deps.db, g.id);
      const res = await call('POST', `/api/channels/${channel.id}/messages`, finance.cookie, {
        body: 'see the contract',
        fileIds: [file.id],
        clientId: randomUUID(),
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_attachment' });
    });

    it('cannot be attached to a task', async () => {
      const g = await newGroup();
      const finance = await adminSession(true);
      const file = await financeFile(g.id, finance.cookie);
      const res = await call('POST', `/api/groups/${g.id}/tasks`, finance.cookie, {
        title: 'Task',
        fileIds: [file.id],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_attachment' });
    });

    it('cannot be attached to a knowledge item', async () => {
      const g = await newGroup();
      const finance = await adminSession(true);
      const file = await financeFile(g.id, finance.cookie);
      const res = await call('POST', `/api/groups/${g.id}/knowledge`, finance.cookie, {
        type: 'file',
        title: 'Contract',
        fileIds: [file.id],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_attachment' });
    });
  });

  describe('finance:changed', () => {
    it('reaches the finance room only, never a group room or the admins room', async () => {
      const g = await newGroup();
      const finance = await adminSession(true);
      const other = await adminSession(false);
      const client = await clientIn(g.id);
      const got = { finance: 0, other: 0, client: 0 };
      for (const [key, session] of [
        ['finance', finance],
        ['other', other],
        ['client', client],
      ] as const) {
        const socket = await connected(session.cookie);
        // Admins also join the group's rooms, as on the group's pages.
        if (key !== 'client') {
          await new Promise((resolve) => socket.emit('group:join', { groupId: g.id }, resolve));
        }
        socket.on(FinanceEvents.changed, () => (got[key] += 1));
      }
      emitFinanceChanged(test.app.io, g.id, 'items');
      await new Promise((r) => setTimeout(r, 150));
      expect(got).toEqual({ finance: 1, other: 0, client: 0 });
    });
  });

  describe('the Finance notification group', () => {
    it('an admin without the right can neither see nor set it', async () => {
      const other = await adminSession(false);
      const prefs = await call('GET', '/api/notifications/preferences', other.cookie);
      expect(prefs.json<{ visibleCategories: string[] }>().visibleCategories).not.toContain(
        'finance',
      );
      const patch = await call('PATCH', '/api/notifications/preferences', other.cookie, {
        category: 'finance',
        channel: 'email',
      });
      expect(patch.statusCode).toBe(400);
      const finance = await adminSession(true);
      const ok = await call('PATCH', '/api/notifications/preferences', finance.cookie, {
        category: 'finance',
        channel: 'email',
      });
      expect(ok.statusCode).toBe(200);
    });
  });
});
