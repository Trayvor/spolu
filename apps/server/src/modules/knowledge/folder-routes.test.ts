import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  KnowledgeEvents,
  SocketEvents,
  type KnowledgeFolderDto,
  type KnowledgeFolderEvent,
  type KnowledgeFolderList,
  type KnowledgeItemDto,
  type KnowledgeItemEvent,
  type KnowledgePage,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMembership } from '../groups/memberships.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('knowledge folders API', () => {
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

  async function newAdmin(): Promise<Person> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: 'Kb Admin' });
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string, name = 'Kb Client'): Promise<Person> {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name, role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () => createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });

  const folder = async (
    cookie: string,
    groupId: string,
    body: { name: string; parentId?: string | null; visibility?: 'public' | 'admins' },
  ) => {
    const res = await call('POST', `/api/groups/${groupId}/knowledge/folders`, cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<KnowledgeFolderDto>();
  };
  const item = async (cookie: string, groupId: string, over: Record<string, unknown> = {}) => {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, {
      type: 'note',
      title: 'A note',
      ...over,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<KnowledgeItemDto>();
  };

  async function socketOf(cookie: string): Promise<Socket> {
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    return socket;
  }

  function record(socket: Socket) {
    const events: { name: string; payload: unknown }[] = [];
    socket.onAny((name: string, payload: unknown) => {
      if (name.startsWith('knowledge:')) events.push({ name, payload });
    });
    return events;
  }

  const until = async (check: () => boolean, ms = 2000) => {
    const start = Date.now();
    while (!check()) {
      if (Date.now() - start > ms) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const settle = () => new Promise((r) => setTimeout(r, 300));

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
    const id = randomUUID();
    for (const [method, url] of [
      ['GET', `/api/groups/${id}/knowledge/folders`],
      ['POST', `/api/groups/${id}/knowledge/folders`],
      ['PATCH', `/api/knowledge/folders/${id}`],
      ['DELETE', `/api/knowledge/folders/${id}`],
    ] as const) {
      expect((await call(method, url, undefined, { name: 'x' })).statusCode).toBe(401);
    }
  });

  it('create, list, rename, move and delete', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const a = await folder(client.cookie, g.id, { name: 'Grants' });
    const b = await folder(admin.cookie, g.id, { name: 'Archive', parentId: a.id });
    const list = await call('GET', `/api/groups/${g.id}/knowledge/folders`, client.cookie);
    expect(list.statusCode).toBe(200);
    expect(list.json<KnowledgeFolderList>().folders.map((f) => f.name)).toEqual([
      'Archive',
      'Grants',
    ]);
    const renamed = await call('PATCH', `/api/knowledge/folders/${b.id}`, client.cookie, {
      name: 'Old',
      parentId: null,
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json<KnowledgeFolderDto>()).toMatchObject({ name: 'Old', parentId: null });
    const cycle = await call('PATCH', `/api/knowledge/folders/${a.id}`, admin.cookie, {
      parentId: a.id,
    });
    expect(cycle.statusCode).toBe(400);
    expect(cycle.json()).toEqual({ error: 'invalid_folder' });
    expect(
      (await call('PATCH', `/api/knowledge/folders/${a.id}`, admin.cookie, {})).statusCode,
    ).toBe(400);
    const gone = await call('DELETE', `/api/knowledge/folders/${b.id}`, client.cookie);
    expect(gone.statusCode).toBe(204);
  });

  it('a hidden folder is 404 for a client on every route; a ziadatel gets 404', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const secret = await folder(admin.cookie, g.id, { name: 'Secret', visibility: 'admins' });
    const open = await folder(client.cookie, g.id, { name: 'Open' });
    const own = await item(client.cookie, g.id);
    const notFound = { error: 'not_found' };
    const answers = [
      await call('GET', `/api/groups/${g.id}/knowledge?folder=${secret.id}`, client.cookie),
      await call('POST', `/api/groups/${g.id}/knowledge/folders`, client.cookie, {
        name: 'X',
        parentId: secret.id,
      }),
      await call('PATCH', `/api/knowledge/folders/${secret.id}`, client.cookie, { name: 'X' }),
      await call('PATCH', `/api/knowledge/folders/${open.id}`, client.cookie, {
        parentId: secret.id,
      }),
      await call('DELETE', `/api/knowledge/folders/${secret.id}`, client.cookie),
      await call('POST', `/api/groups/${g.id}/knowledge`, client.cookie, {
        type: 'note',
        title: 'x',
        folderId: secret.id,
      }),
      await call('PATCH', `/api/knowledge/${own.id}`, client.cookie, {
        folderId: secret.id,
        updatedAt: own.updatedAt,
      }),
    ];
    for (const res of answers) {
      expect(res.statusCode, res.body).toBe(404);
      expect(res.json()).toEqual(notFound);
    }
    const unknown = randomUUID();
    const probe = await call(
      'GET',
      `/api/groups/${g.id}/knowledge?folder=${unknown}`,
      client.cookie,
    );
    expect(probe.statusCode).toBe(404);

    const list = await call('GET', `/api/groups/${g.id}/knowledge/folders`, client.cookie);
    expect(list.json<KnowledgeFolderList>().folders.map((f) => f.id)).toEqual([open.id]);
    expect(list.body).not.toContain('Secret');

    const asks = await call('POST', `/api/groups/${g.id}/knowledge/folders`, client.cookie, {
      name: 'Mine',
      visibility: 'admins',
    });
    expect(asks.statusCode).toBe(400);
    expect(asks.json()).toEqual({ error: 'invalid_visibility' });

    const zEmail = newEmail();
    const zId = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id: zId, email: zEmail, name: 'Zia', role: 'client', emailVerified: true });
    await addMembership(test.deps.db, zId, g.id, 'ziadatel');
    const zCookie = await loginAs(test.app, zEmail);
    expect((await call('GET', `/api/groups/${g.id}/knowledge/folders`, zCookie)).statusCode).toBe(
      404,
    );
  });

  it('the tab lists one folder with ?folder=, the top level with root, all without', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const a = await folder(admin.cookie, g.id, { name: 'A' });
    const top = await item(admin.cookie, g.id, { title: 'Top' });
    const inside = await item(admin.cookie, g.id, { title: 'Inside', folderId: a.id });
    const page = async (qs: string) =>
      (await call('GET', `/api/groups/${g.id}/knowledge${qs}`, admin.cookie))
        .json<KnowledgePage>()
        .items.map((i) => i.id);
    expect(await page('?folder=root')).toEqual([top.id]);
    expect(await page(`?folder=${a.id}`)).toEqual([inside.id]);
    expect(await page('')).toEqual([inside.id, top.id]);
    const found = await call('GET', `/api/groups/${g.id}/knowledge?q=inside`, admin.cookie);
    expect(found.json<KnowledgePage>().items[0]!.folderPath).toEqual([{ id: a.id, name: 'A' }]);
    expect(
      (await call('GET', `/api/groups/${g.id}/knowledge?folder=bad id`, admin.cookie)).statusCode,
    ).toBe(400);
  });

  it('the client search never shows an admins-only folder in a path', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const secret = await folder(admin.cookie, g.id, { name: 'Secret', visibility: 'admins' });
    await item(admin.cookie, g.id, { title: 'Budget hidden', folderId: secret.id });
    await item(client.cookie, g.id, { title: 'Budget open' });
    const res = await call('GET', `/api/groups/${g.id}/knowledge?q=budget`, client.cookie);
    expect(res.json<KnowledgePage>().items.map((i) => i.title)).toEqual(['Budget open']);
    expect(res.body).not.toContain('Secret');
  });

  describe('realtime', () => {
    async function pair() {
      const admin = await newAdmin();
      const g = await newGroup();
      const client = await clientIn(g.id);
      const adminSocket = await socketOf(admin.cookie);
      const ack = await adminSocket.emitWithAck(SocketEvents.groupJoin, { groupId: g.id });
      expect(ack).toEqual({ ok: true });
      const clientSocket = await socketOf(client.cookie);
      return {
        admin,
        client,
        g,
        adminEvents: record(adminSocket),
        clientEvents: record(clientSocket),
      };
    }

    it('public folder events reach the client; admins-only ones only the admins', async () => {
      const { admin, g, adminEvents, clientEvents } = await pair();
      const open = await folder(admin.cookie, g.id, { name: 'Open' });
      await until(() => clientEvents.length === 1 && adminEvents.length === 1);
      expect(clientEvents[0]).toEqual({
        name: KnowledgeEvents.folder,
        payload: { folder: open } satisfies KnowledgeFolderEvent,
      });
      const secret = await folder(admin.cookie, g.id, { name: 'Secret', visibility: 'admins' });
      await call('PATCH', `/api/knowledge/folders/${secret.id}`, admin.cookie, { name: 'S2' });
      await call('DELETE', `/api/knowledge/folders/${secret.id}`, admin.cookie);
      await until(() => adminEvents.length === 4);
      expect(adminEvents.slice(1).map((e) => e.name)).toEqual([
        KnowledgeEvents.folder,
        KnowledgeEvents.folder,
        KnowledgeEvents.folderDeleted,
      ]);
      await call('DELETE', `/api/knowledge/folders/${open.id}`, admin.cookie);
      await until(() => clientEvents.length === 2);
      expect(clientEvents[1]).toEqual({
        name: KnowledgeEvents.folderDeleted,
        payload: { groupId: g.id, id: open.id },
      });
      await settle();
      expect(JSON.stringify(clientEvents)).not.toContain('Secret');
      expect(JSON.stringify(clientEvents)).not.toContain('S2');
    });

    it('a folder turning admins-only is deleted for the clients with its items', async () => {
      const { admin, g, adminEvents, clientEvents } = await pair();
      const a = await folder(admin.cookie, g.id, { name: 'A' });
      const inside = await item(admin.cookie, g.id, { folderId: a.id });
      await until(() => clientEvents.length === 2 && adminEvents.length === 2);
      const res = await call('PATCH', `/api/knowledge/folders/${a.id}`, admin.cookie, {
        visibility: 'admins',
      });
      expect(res.statusCode).toBe(200);
      await until(() => clientEvents.length === 4 && adminEvents.length === 3);
      expect(clientEvents.slice(2)).toEqual([
        { name: KnowledgeEvents.folderDeleted, payload: { groupId: g.id, id: a.id } },
        { name: KnowledgeEvents.itemDeleted, payload: { groupId: g.id, id: inside.id } },
      ]);
      expect(adminEvents[2]!.name).toBe(KnowledgeEvents.folder);
      await settle();
      expect(clientEvents).toHaveLength(4);
      expect(adminEvents).toHaveLength(3);
    });

    it('an item moved into an admins-only folder disappears for the client', async () => {
      const { admin, g, adminEvents, clientEvents } = await pair();
      const secret = await folder(admin.cookie, g.id, { name: 'Secret', visibility: 'admins' });
      const it1 = await item(admin.cookie, g.id);
      await until(() => clientEvents.length === 1 && adminEvents.length === 2);
      const moved = await call('PATCH', `/api/knowledge/${it1.id}`, admin.cookie, {
        folderId: secret.id,
        updatedAt: it1.updatedAt,
      });
      expect(moved.statusCode).toBe(200);
      await until(() => clientEvents.length === 2 && adminEvents.length === 3);
      expect(clientEvents[1]).toEqual({
        name: KnowledgeEvents.itemDeleted,
        payload: { groupId: g.id, id: it1.id },
      });
      const sent = (adminEvents[2]!.payload as KnowledgeItemEvent).item;
      expect(sent.folderId).toBe(secret.id);
      expect(sent.folderPath).toEqual([{ id: secret.id, name: 'Secret' }]);
    });
  });
});
