import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import {
  KnowledgeEvents,
  SocketEvents,
  type KnowledgeItemDeletedEvent,
  type KnowledgeItemDto,
  type KnowledgeItemEvent,
  type KnowledgePage,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { files } from '../files/schema.js';
import { createFile } from '../files/service.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
const token = () => `tok${randomUUID().replaceAll('-', '').slice(0, 12)}`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('knowledge API', () => {
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

  const upload = (groupId: string, uploadedBy: string) =>
    createFile(
      { db: test.deps.db, storage: test.deps.storage },
      {
        groupId,
        uploadedBy,
        name: 'doc.pdf',
        declaredType: 'application/pdf',
        body: Readable.from([Buffer.from('content')]),
      },
    );

  const create = async (cookie: string, groupId: string, draft: Record<string, unknown>) => {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, draft);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<KnowledgeItemDto>();
  };
  const note = (over: Record<string, unknown> = {}) => ({ type: 'note', title: 'A note', ...over });
  const reminder = (over: Record<string, unknown> = {}) => ({
    type: 'reminder',
    title: 'Call the bank',
    reminder: { times: [{ at: inHours(2) }], recipientIds: [] },
    ...over,
  });

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

  /** Every knowledge event the socket receives, in order. */
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

  it('401 without a session on every route', async () => {
    const id = randomUUID();
    const g = await newGroup();
    for (const [method, url] of [
      ['GET', `/api/groups/${g.id}/knowledge`],
      ['POST', `/api/groups/${g.id}/knowledge`],
      ['GET', '/api/knowledge'],
      ['GET', '/api/knowledge/scope'],
      ['GET', `/api/knowledge/${id}`],
      ['PATCH', `/api/knowledge/${id}`],
      ['DELETE', `/api/knowledge/${id}`],
    ] as const) {
      expect((await call(method, url, undefined, {})).statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('an admin creates, reads, edits and deletes an item; the tab lists it', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const item = await create(admin.cookie, g.id, note({ body: 'Hello' }));
    expect(item).toMatchObject({
      groupId: g.id,
      type: 'note',
      visibility: 'public',
      canEdit: true,
    });
    const page = (
      await call('GET', `/api/groups/${g.id}/knowledge`, admin.cookie)
    ).json<KnowledgePage>();
    expect(page.items.map((i) => i.id)).toEqual([item.id]);
    const read = await call('GET', `/api/knowledge/${item.id}`, admin.cookie);
    expect(read.json<KnowledgeItemDto>().body).toBe('Hello');
    const edited = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
      title: 'Renamed',
      updatedAt: item.updatedAt,
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<KnowledgeItemDto>().title).toBe('Renamed');
    expect((await call('DELETE', `/api/knowledge/${item.id}`, admin.cookie)).statusCode).toBe(204);
    expect((await call('GET', `/api/knowledge/${item.id}`, admin.cookie)).statusCode).toBe(404);
  });

  it('an unknown group is 404 on list and create', async () => {
    const admin = await newAdmin();
    const id = randomUUID();
    expect((await call('GET', `/api/groups/${id}/knowledge`, admin.cookie)).statusCode).toBe(404);
    const res = await call('POST', `/api/groups/${id}/knowledge`, admin.cookie, note());
    expect(res.statusCode).toBe(404);
  });

  it('a client gets 404 on an admins-only item, its file and its .ics', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const file = await upload(g.id, admin.id);
    const secret = await create(
      admin.cookie,
      g.id,
      note({ title: 'Secret', visibility: 'admins', fileIds: [file.id] }),
    );
    const remind = await create(admin.cookie, g.id, reminder({ visibility: 'admins' }));

    for (const url of [
      `/api/knowledge/${secret.id}`,
      `/api/files/${file.id}`,
      `/api/knowledge/${remind.id}`,
      `/api/knowledge/${remind.id}/reminders`,
      `/api/knowledge/${remind.id}/reminders/calendar.ics`,
    ]) {
      expect((await call('GET', url, client.cookie)).statusCode, url).toBe(404);
      expect((await call('GET', url, admin.cookie)).statusCode, url).toBe(200);
    }
    for (const method of ['POST', 'DELETE'] as const) {
      const url = `/api/knowledge/${remind.id}/reminders/subscription`;
      expect((await call(method, url, client.cookie)).statusCode).toBe(404);
    }
    const patch = await call('PATCH', `/api/knowledge/${secret.id}`, client.cookie, {
      title: 'x',
      updatedAt: secret.updatedAt,
    });
    expect(patch.statusCode).toBe(404);
    expect((await call('DELETE', `/api/knowledge/${secret.id}`, client.cookie)).statusCode).toBe(
      404,
    );
    const page = (
      await call('GET', `/api/groups/${g.id}/knowledge`, client.cookie)
    ).json<KnowledgePage>();
    expect(page.items).toEqual([]);
    // A search matching only the admins-only item finds nothing for the client.
    const found = (
      await call('GET', `/api/groups/${g.id}/knowledge?q=Secret`, client.cookie)
    ).json<KnowledgePage>();
    expect(found.items).toEqual([]);
  });

  it('a client of another group gets 404 on the list, the item and create', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const other = await newGroup();
    const outsider = await clientIn(other.id);
    const item = await create(admin.cookie, g.id, note());
    expect((await call('GET', `/api/groups/${g.id}/knowledge`, outsider.cookie)).statusCode).toBe(
      404,
    );
    expect((await call('GET', `/api/knowledge/${item.id}`, outsider.cookie)).statusCode).toBe(404);
    const res = await call('POST', `/api/groups/${g.id}/knowledge`, outsider.cookie, note());
    expect(res.statusCode).toBe(404);
    const patch = await call('PATCH', `/api/knowledge/${item.id}`, outsider.cookie, {
      title: 'x',
      updatedAt: item.updatedAt,
    });
    expect(patch.statusCode).toBe(404);
    expect((await call('DELETE', `/api/knowledge/${item.id}`, outsider.cookie)).statusCode).toBe(
      404,
    );
  });

  it('POST to an unreadable or unknown group is 404 even with an invalid body', async () => {
    const g = await newGroup();
    const outsider = await clientIn((await newGroup()).id);
    const admin = await newAdmin();
    for (const [groupId, cookie] of [
      [g.id, outsider.cookie],
      [randomUUID(), admin.cookie],
    ] as const) {
      const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, { type: 'poem' });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('a client cannot create admins-only', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const res = await call(
      'POST',
      `/api/groups/${g.id}/knowledge`,
      client.cookie,
      note({ visibility: 'admins' }),
    );
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_visibility' });
  });

  it("an admin cannot make a client's item admins-only", async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const item = await create(client.cookie, g.id, note());
    expect(item.visibilityLocked).toBe(true);
    const res = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
      visibility: 'admins',
      updatedAt: item.updatedAt,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_visibility' });
  });

  it('another client gets 403 on edit and delete; the author may do both', async () => {
    const g = await newGroup();
    const author = await clientIn(g.id);
    const other = await clientIn(g.id);
    const item = await create(author.cookie, g.id, note());
    expect((await call('GET', `/api/knowledge/${item.id}`, other.cookie)).json()).toMatchObject({
      canEdit: false,
    });
    const patch = await call('PATCH', `/api/knowledge/${item.id}`, other.cookie, {
      title: 'Mine now',
      updatedAt: item.updatedAt,
    });
    expect(patch.statusCode).toBe(403);
    expect(patch.json()).toEqual({ error: 'forbidden' });
    const del = await call('DELETE', `/api/knowledge/${item.id}`, other.cookie);
    expect(del.statusCode).toBe(403);
    const edited = await call('PATCH', `/api/knowledge/${item.id}`, author.cookie, {
      title: 'Edited',
      updatedAt: item.updatedAt,
    });
    expect(edited.statusCode).toBe(200);
    expect((await call('DELETE', `/api/knowledge/${item.id}`, author.cookie)).statusCode).toBe(204);
  });

  it('PATCH with stale updatedAt is 409 knowledge_changed', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const item = await create(admin.cookie, g.id, note());
    const first = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
      title: 'One',
      updatedAt: item.updatedAt,
    });
    expect(first.statusCode).toBe(200);
    const stale = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
      title: 'Two',
      updatedAt: item.updatedAt,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toEqual({ error: 'knowledge_changed' });
  });

  it('invalid url is 400 invalid_url', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    for (const url of ['javascript:alert(1)', 'not a url', `https://x.sk/${'a'.repeat(2050)}`]) {
      const res = await call('POST', `/api/groups/${g.id}/knowledge`, admin.cookie, {
        type: 'link',
        title: 'Link',
        url,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_url' });
    }
    const item = await create(admin.cookie, g.id, note());
    const patch = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
      url: 'https://example.com',
      updatedAt: item.updatedAt,
    });
    expect(patch.json()).toEqual({ error: 'invalid_url' }); // a url on a note
  });

  it('maps the reminder and other body errors', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const post = (body: unknown) =>
      call('POST', `/api/groups/${g.id}/knowledge`, admin.cookie, body);
    const cases: [unknown, string][] = [
      [reminder({ reminder: { times: [], recipientIds: [] } }), 'invalid_reminder'],
      [reminder({ reminder: { times: [{ at: 'soon' }], recipientIds: [] } }), 'invalid_reminder'],
      [
        reminder({ reminder: { times: [{ at: inHours(2) }], recipientIds: ['bad id!'] } }),
        'invalid_recipient',
      ],
      [
        reminder({ reminder: { times: [{ at: inHours(-1) }], recipientIds: [] } }),
        'reminder_in_past',
      ],
      [
        reminder({ reminder: { times: [{ at: inHours(2) }], recipientIds: [randomUUID()] } }),
        'invalid_recipient',
      ],
      [{ type: 'note' }, 'validation_failed'],
      [{ type: 'poem', title: 'x' }, 'validation_failed'],
      [note({ fileIds: [randomUUID()] }), 'invalid_attachment'],
    ];
    for (const [body, error] of cases) {
      const res = await post(body);
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json(), JSON.stringify(body)).toEqual({ error });
    }
    const item = await create(admin.cookie, g.id, note());
    const typed = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
      type: 'link',
      updatedAt: item.updatedAt,
    });
    expect(typed.json()).toEqual({ error: 'validation_failed' });
    const cursor = await call('GET', `/api/groups/${g.id}/knowledge?cursor=nope`, admin.cookie);
    expect(cursor.statusCode).toBe(400);
    expect(cursor.json()).toEqual({ error: 'validation_failed' });
    const type = await call('GET', `/api/groups/${g.id}/knowledge?type=poem`, admin.cookie);
    expect(type.statusCode).toBe(400);
    const oneBad = await call('GET', `/api/groups/${g.id}/knowledge?type=note,poem`, admin.cookie);
    expect(oneBad.statusCode).toBe(400);
  });

  it('the group list filters by one type or several', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const n = await create(admin.cookie, g.id, note());
    const l = await create(admin.cookie, g.id, {
      type: 'link',
      title: 'L',
      url: 'https://example.com',
      fileIds: [],
    });
    const list = async (query: string) => {
      const res = await call('GET', `/api/groups/${g.id}/knowledge${query}`, admin.cookie);
      expect(res.statusCode, query).toBe(200);
      return res.json<KnowledgePage>().items.map((i) => i.id);
    };
    expect(await list('?type=note')).toEqual([n.id]);
    expect(await list('?type=note,link')).toEqual([l.id, n.id]);
    expect(await list('?type=note&type=link')).toEqual([l.id, n.id]);
    expect(await list('?type=file,reminder')).toEqual([]);
    expect(await list('?type=')).toEqual([l.id, n.id]);
  });

  it('a file removed by an edit is deleted after the commit', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const [a, b] = [await upload(g.id, admin.id), await upload(g.id, admin.id)];
    const item = await create(admin.cookie, g.id, note({ fileIds: [a.id, b.id] }));
    const res = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
      fileIds: [a.id],
      updatedAt: item.updatedAt,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<KnowledgeItemDto>().files.map((f) => f.id)).toEqual([a.id]);
    // Deleted after the answer, not before it.
    const left = () => test.deps.db.select().from(files).where(eq(files.id, b.id));
    for (let i = 0; i < 100 && (await left()).length > 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(await left()).toEqual([]);
    expect((await call('GET', `/api/files/${b.id}`, admin.cookie)).statusCode).toBe(404);
    expect((await call('GET', `/api/files/${a.id}`, admin.cookie)).statusCode).toBe(200);
  });

  describe('global list', () => {
    it('GET /api/knowledge is 403 for clients', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      expect((await call('GET', '/api/knowledge', client.cookie)).statusCode).toBe(403);
      expect((await call('GET', '/api/knowledge/scope', client.cookie)).statusCode).toBe(403);
    });

    it('clients over 200 is 400', async () => {
      const admin = await newAdmin();
      const ids = Array.from({ length: 201 }, () => randomUUID()).join(',');
      const res = await call('GET', `/api/knowledge?clients=${ids}`, admin.cookie);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
      const bad = await call('GET', '/api/knowledge?clients=a%20b', admin.cookie);
      expect(bad.statusCode).toBe(400);
      const ok = Array.from({ length: 200 }, () => randomUUID()).join(',');
      expect((await call('GET', `/api/knowledge?clients=${ok}`, admin.cookie)).statusCode).toBe(
        200,
      );
    });

    it('the default scope is the managed groups, or all groups when the admin manages none', async () => {
      const admin = await newAdmin();
      const [g1, g2] = [await newGroup(), await newGroup()];
      const tok = token();
      const one = await create(admin.cookie, g1.id, note({ title: `${tok} one` }));
      const two = await create(
        admin.cookie,
        g2.id,
        note({ title: `${tok} two`, visibility: 'admins' }),
      );
      const list = async (query = '') =>
        (await call('GET', `/api/knowledge?q=${tok}${query}`, admin.cookie)).json<KnowledgePage>();

      const all = await list();
      expect(all.items.map((i) => i.id)).toEqual([two.id, one.id]);
      expect(all.items[1]!.group).toMatchObject({ id: g1.id, name: 'Firma' });

      await addManager(test.deps.db, g1.id, admin.id);
      expect((await list()).items.map((i) => i.id)).toEqual([one.id]);
      // An explicit `clients` filter wins over the default scope.
      expect((await list(`&clients=${g2.id}`)).items.map((i) => i.id)).toEqual([two.id]);
      expect((await list(`&clients=${g1.id},${g2.id}&type=link`)).items).toEqual([]);
    });

    it('scope=all lists every group and ignores the managed groups', async () => {
      const admin = await newAdmin();
      const [g1, g2] = [await newGroup(), await newGroup()];
      const tok = token();
      const one = await create(admin.cookie, g1.id, note({ title: `${tok} one` }));
      const two = await create(admin.cookie, g2.id, note({ title: `${tok} two` }));
      const list = (query: string) => call('GET', `/api/knowledge?q=${tok}${query}`, admin.cookie);

      await addManager(test.deps.db, g1.id, admin.id);
      const all = await list('&scope=all');
      expect(all.statusCode).toBe(200);
      expect(all.json<KnowledgePage>().items.map((i) => i.id)).toEqual([two.id, one.id]);
      expect((await list('&scope=all&type=link')).json<KnowledgePage>().items).toEqual([]);
      expect(
        (await list('&scope=all&type=link,note')).json<KnowledgePage>().items.map((i) => i.id),
      ).toEqual([two.id, one.id]);
      // `scope=all` and `clients` contradict each other; any other scope is unknown.
      const both = await list(`&scope=all&clients=${g1.id}`);
      expect(both.statusCode).toBe(400);
      expect(both.json()).toEqual({ error: 'validation_failed' });
      expect((await list('&scope=mine')).statusCode).toBe(400);
    });

    it('scope=all is 403 for clients', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      expect((await call('GET', '/api/knowledge?scope=all', client.cookie)).statusCode).toBe(403);
    });

    it('GET /api/knowledge/scope answers the managed group ids', async () => {
      const admin = await newAdmin();
      const none = await call('GET', '/api/knowledge/scope', admin.cookie);
      expect(none.statusCode).toBe(200);
      expect(none.json()).toEqual({ managedGroupIds: [] });
      const g = await newGroup();
      await addManager(test.deps.db, g.id, admin.id);
      const res = await call('GET', '/api/knowledge/scope', admin.cookie);
      expect(res.json()).toEqual({ managedGroupIds: [g.id] });
    });
  });

  it('writes over 120/min answer 429', async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const id = randomUUID();
    for (let i = 0; i < 120; i++) {
      // An invalid body: the limit counts the request before the body is checked.
      const res = await call('PATCH', `/api/knowledge/${id}`, client.cookie, {});
      expect(res.statusCode).toBe(400);
    }
    const limited = await call('POST', `/api/groups/${g.id}/knowledge`, client.cookie, note());
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({ error: 'rate_limited' });
    expect((await call('DELETE', `/api/knowledge/${id}`, client.cookie)).statusCode).toBe(429);
    // Reminder subscriptions share the same limit.
    expect(
      (await call('POST', `/api/knowledge/${id}/reminders/subscription`, client.cookie)).statusCode,
    ).toBe(429);
    // Reads are not limited; other users are not affected.
    expect((await call('GET', `/api/groups/${g.id}/knowledge`, client.cookie)).statusCode).toBe(
      200,
    );
    const other = await clientIn(g.id);
    await create(other.cookie, g.id, note());
  });

  describe('realtime', () => {
    /** An admin who joined the group, and the group's client, both recording events. */
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

    it('public events reach the client', async () => {
      const { admin, g, adminEvents, clientEvents } = await pair();
      const item = await create(admin.cookie, g.id, note());
      await until(() => clientEvents.length === 1 && adminEvents.length === 1);
      expect(clientEvents[0]).toEqual({
        name: KnowledgeEvents.item,
        payload: { item: expect.objectContaining({ id: item.id, visibility: 'public' }) },
      });
      // A summary only: no body, files, reminder or the author's own flags.
      const sent = (clientEvents[0]!.payload as KnowledgeItemEvent).item as Record<string, unknown>;
      for (const key of ['body', 'files', 'reminder', 'canEdit', 'visibilityLocked']) {
        expect(sent).not.toHaveProperty(key);
      }
      await call('DELETE', `/api/knowledge/${item.id}`, admin.cookie);
      await until(() => clientEvents.length === 2 && adminEvents.length === 2);
      expect(clientEvents[1]).toEqual({
        name: KnowledgeEvents.itemDeleted,
        payload: { groupId: g.id, id: item.id } satisfies KnowledgeItemDeletedEvent,
      });
    });

    it('admins-only events reach only the admin', async () => {
      const { admin, g, adminEvents, clientEvents } = await pair();
      const item = await create(
        admin.cookie,
        g.id,
        note({ title: 'Secret', visibility: 'admins' }),
      );
      await until(() => adminEvents.length === 1);
      const edited = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        title: 'Still secret',
        updatedAt: item.updatedAt,
      });
      expect(edited.statusCode).toBe(200);
      await call('DELETE', `/api/knowledge/${item.id}`, admin.cookie);
      await until(() => adminEvents.length === 3);
      expect(adminEvents.map((e) => e.name)).toEqual([
        KnowledgeEvents.item,
        KnowledgeEvents.item,
        KnowledgeEvents.itemDeleted,
      ]);
      await settle();
      expect(clientEvents).toEqual([]);
    });

    it('public → admins sends item_deleted to the client only and the item to the admins', async () => {
      const { admin, g, adminEvents, clientEvents } = await pair();
      const item = await create(admin.cookie, g.id, note());
      await until(() => clientEvents.length === 1 && adminEvents.length === 1);

      const hidden = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        visibility: 'admins',
        updatedAt: item.updatedAt,
      });
      expect(hidden.statusCode).toBe(200);
      await until(() => clientEvents.length === 2 && adminEvents.length === 2);
      expect(clientEvents[1]).toEqual({
        name: KnowledgeEvents.itemDeleted,
        payload: { groupId: g.id, id: item.id },
      });
      // Admins are in the group room too, but the delete skips them: their open view stays.
      await settle();
      expect(adminEvents.slice(1).map((e) => e.name)).toEqual([KnowledgeEvents.item]);
      expect((adminEvents[1]!.payload as KnowledgeItemEvent).item.visibility).toBe('admins');

      // Admins → public: the item goes to the group room again.
      const shown = await call('PATCH', `/api/knowledge/${item.id}`, admin.cookie, {
        visibility: 'public',
        updatedAt: hidden.json<KnowledgeItemDto>().updatedAt,
      });
      expect(shown.statusCode).toBe(200);
      await until(() => clientEvents.length === 3 && adminEvents.length === 3);
      expect((clientEvents[2]!.payload as KnowledgeItemEvent).item.visibility).toBe('public');
      await settle();
      expect(clientEvents).toHaveLength(3);
    });
  });
});
