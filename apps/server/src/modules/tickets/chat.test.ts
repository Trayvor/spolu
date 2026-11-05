import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import type { GroupChannel, GroupPerson, MessageDto, TicketDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { channels } from '../chat/schema.js';
import { tickets } from './schema.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { createFile, getFile } from '../files/service.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { user } from '../users/schema.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `c${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('ticket chat', () => {
  let test: TestApp;
  // Deactivated in afterAll: a ticket without a client notifies every active admin of the
  // shared test database, so admins left active make later runs slower.
  const admins: string[] = [];
  let baseUrl = '';
  const sockets: Socket[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const send = (channelId: string, cookie: string, body: object) =>
    call('POST', `/api/channels/${channelId}/messages`, cookie, {
      clientId: randomUUID(),
      ...body,
    });

  async function group() {
    const h = host();
    return {
      ...(await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` })),
      host: h,
    };
  }
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel', name = 'Člen') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, name, cookie: await loginAs(test.app, c.email) };
  }
  async function ticket(g: { host: string } | null, email?: string) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        subject: 'Chyba',
        email,
        ...(g ? { instance_url: `https://${g.host}.egrant.sk` } : {}),
      },
    });
    return res.json<{ id: string }>().id;
  }
  const chatOf = async (ticketId: string, cookie: string) =>
    (await call('GET', `/api/tickets/${ticketId}/chat`, cookie)).json<GroupChannel>();

  it('a ticket with a client has a chat; one without gets it when assigned', async () => {
    const g = await group();
    const a = await admin();
    const withClient = await ticket(g);
    const dto = (await call('GET', `/api/tickets/${withClient}`, a.cookie)).json<TicketDto>();
    expect(dto.channelId).not.toBeNull();
    expect((await chatOf(withClient, a.cookie)).id).toBe(dto.channelId);

    const without = await ticket(null);
    expect((await call('GET', `/api/tickets/${without}/chat`, a.cookie)).statusCode).toBe(404);
    expect(
      (await call('GET', `/api/tickets/${without}`, a.cookie)).json<TicketDto>().channelId,
    ).toBeNull();
    await call('PUT', `/api/tickets/${without}/group`, a.cookie, { groupId: g.id });
    expect((await call('GET', `/api/tickets/${without}/chat`, a.cookie)).statusCode).toBe(200);
  });

  it('the ziadatel and the group clients write in the chat; others get 404', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel', 'Žiadateľ');
    const client = await member(g.id, 'client', 'Klient');
    const own = await ticket(g, z.email);
    const foreign = await ticket(g);
    const chat = await chatOf(own, z.cookie);
    expect((await send(chat.id, z.cookie, { body: 'Dobrý deň' })).statusCode).toBe(201);
    expect((await send(chat.id, client.cookie, { body: 'Pozrieme sa' })).statusCode).toBe(201);
    const page = await call('GET', `/api/channels/${chat.id}/messages`, z.cookie);
    expect(
      page
        .json<{ messages: MessageDto[] }>()
        .messages.map((m) => m.body)
        .sort(),
    ).toEqual(['Dobrý deň', 'Pozrieme sa']);

    // Another ticket's chat and the group's own chat stay closed to the ziadatel.
    const foreignChat = (
      await call('GET', `/api/tickets/${foreign}/chat`, client.cookie)
    ).json<GroupChannel>();
    expect((await call('GET', `/api/tickets/${foreign}/chat`, z.cookie)).statusCode).toBe(404);
    expect((await send(foreignChat.id, z.cookie, { body: 'x' })).statusCode).toBe(404);
    expect((await call('GET', `/api/groups/${g.id}/chat`, z.cookie)).statusCode).toBe(404);
    const stranger = await member((await group()).id, 'client');
    expect((await call('GET', `/api/tickets/${own}/chat`, stranger.cookie)).statusCode).toBe(404);
  });

  it("the initiator can be mentioned; the people list includes them; events are the ticket's", async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel', 'Jana Žiadateľka');
    const client = await member(g.id, 'client', 'Klient');
    const own = await ticket(g, z.email);
    const chat = await chatOf(own, client.cookie);

    const people = (await call('GET', `/api/channels/${chat.id}/people`, z.cookie)).json<
      GroupPerson[]
    >();
    expect(people.map((p) => p.id)).toEqual(expect.arrayContaining([z.id, client.id]));

    const res = await send(chat.id, client.cookie, { body: `<@${z.id}> pozrite sa, @all` });
    expect(res.statusCode).toBe(201);
    const outsider = await member((await group()).id, 'client');
    expect((await send(chat.id, client.cookie, { body: `<@${outsider.id}>` })).statusCode).toBe(
      400,
    );

    const recorded = await db()
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.groupId, g.id));
    // No group chat kinds: the admins and the initiator get ticket.message, the named people a
    // mention that carries the ticket (part 21.6).
    const ofChat = recorded.filter(
      (e) => (e.payload as { channelId?: string }).channelId === chat.id,
    );
    expect(ofChat.length).toBeGreaterThan(0);
    for (const e of ofChat) {
      expect(['ticket.message', 'chat.mention']).toContain(e.kind);
      expect(e.payload).toMatchObject({ ticketId: own });
    }
  });

  it("the initiator's sockets get the chat's messages though they are in no group room", async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const a = await admin();
    const own = await ticket(g, z.email);
    const chat = await chatOf(own, a.cookie);
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie: z.cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    const got = new Promise<{ channelId: string; message: MessageDto }>((resolve) =>
      socket.once('chat:message', resolve),
    );
    await send(chat.id, a.cookie, { body: 'Odpoveď' });
    const event = await got;
    expect(event.channelId).toBe(chat.id);
    expect(event.message.body).toBe('Odpoveď');
  });

  it("the ziadatel reads files of their ticket's chat, never the group's other files", async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const a = await admin();
    const own = await ticket(g, z.email);
    const chat = await chatOf(own, a.cookie);
    const upload = (name: string) =>
      createFile(
        { db: db(), storage: test.deps.storage },
        {
          groupId: g.id,
          uploadedBy: a.id,
          name,
          declaredType: 'text/plain',
          body: Readable.from([Buffer.from(name)]),
        },
      );
    const inChat = await upload('v-chate.txt');
    const elsewhere = await upload('inde.txt');
    expect(
      (await send(chat.id, a.cookie, { body: 'Príloha', fileIds: [inChat.id] })).statusCode,
    ).toBe(201);
    expect((await call('GET', `/api/files/${inChat.id}`, z.cookie)).statusCode).toBe(200);
    expect((await call('GET', `/api/files/${elsewhere.id}`, z.cookie)).statusCode).toBe(404);
  });

  it('the chat and its files move with the ticket', async () => {
    const [g1, g2] = [await group(), await group()];
    const a = await admin();
    const id = await ticket(g1);
    const chat = await chatOf(id, a.cookie);
    const file = await createFile(
      { db: db(), storage: test.deps.storage },
      {
        groupId: g1.id,
        uploadedBy: a.id,
        name: 'a.txt',
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from('a')]),
      },
    );
    await send(chat.id, a.cookie, { body: 'x', fileIds: [file.id] });
    await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g2.id });
    const [row] = await db()
      .select()
      .from(channels)
      .where(and(eq(channels.id, chat.id), eq(channels.kind, 'ticket')));
    expect(row?.groupId).toBe(g2.id);
    expect((await getFile(db(), file.id))?.groupId).toBe(g2.id);
    const page = await call('GET', `/api/channels/${chat.id}/messages`, a.cookie);
    expect(
      page.json<{ messages: MessageDto[] }>().messages[0]!.attachments.map((f) => f.id),
    ).toEqual([file.id]);
  });

  describe('the author\'s message clears the "solved on our side" mark', () => {
    async function markedTicket() {
      const g = await group();
      const z = await member(g.id, 'ziadatel', 'Autor');
      const other = await member(g.id, 'client', 'Iný klient');
      const a = await admin();
      const id = await ticket(g, z.email);
      expect(
        (await call('PATCH', `/api/tickets/${id}`, a.cookie, { status: 'in_progress' })).statusCode,
      ).toBe(200);
      expect((await call('POST', `/api/tickets/${id}/admin-done`, a.cookie)).statusCode).toBe(200);
      const chat = await chatOf(id, a.cookie);
      return { id, z, other, a, chat };
    }
    const rowOf = async (id: string) => {
      const [row] = await db().select().from(tickets).where(eq(tickets.id, id));
      return row!;
    };

    it('a message and a thread reply by the author clear it, record it and push ticket:updated', async () => {
      const t = await markedTicket();
      const socket = connect(baseUrl, {
        transports: ['websocket'],
        extraHeaders: { cookie: t.a.cookie },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((resolve) => socket.once('connect', () => resolve(null)));
      const events: unknown[] = [];
      socket.on('ticket:updated', (e) => events.push(e));

      const res = await send(t.chat.id, t.z.cookie, { body: 'Stále to nejde' });
      expect(res.statusCode).toBe(201);
      const row = await rowOf(t.id);
      expect(row.adminDoneAt).toBeNull();
      expect(row.adminDoneBy).toBeNull();
      expect(row.adminDoneClearedAt).not.toBeNull();
      expect(row.status).toBe('in_progress');
      await vi.waitFor(() => expect(events).toHaveLength(1));
      const audit = await auditRowsOf(db(), t.id);
      expect(audit.at(-1)).toMatchObject({ action: 'updated', actorUserId: t.z.id });

      // A second message finds no mark: nothing is written or pushed.
      const cleared = row.adminDoneClearedAt;
      await send(t.chat.id, t.z.cookie, { body: 'Ešte raz' });
      expect((await rowOf(t.id)).adminDoneClearedAt).toEqual(cleared);
      expect(events).toHaveLength(1);

      // A thread reply clears a new mark too.
      expect((await call('POST', `/api/tickets/${t.id}/admin-done`, t.a.cookie)).statusCode).toBe(
        200,
      );
      const root = res.json<MessageDto>();
      expect(
        (await send(t.chat.id, t.z.cookie, { body: 'Odpoveď', parentId: root.id })).statusCode,
      ).toBe(201);
      expect((await rowOf(t.id)).adminDoneAt).toBeNull();
    });

    it('a message by an admin or another client keeps it', async () => {
      const t = await markedTicket();
      expect((await send(t.chat.id, t.a.cookie, { body: 'Admin' })).statusCode).toBe(201);
      expect((await send(t.chat.id, t.other.cookie, { body: 'Kolega' })).statusCode).toBe(201);
      const row = await rowOf(t.id);
      expect(row.adminDoneAt).not.toBeNull();
      expect(row.adminDoneClearedAt).toBeNull();
    });

    it('editing or deleting an earlier message of the author keeps it', async () => {
      const t = await markedTicket();
      const sent = (await send(t.chat.id, t.z.cookie, { body: 'Prvá' })).json<MessageDto>();
      // The first message cleared it; set the mark again, then edit and delete.
      expect((await call('POST', `/api/tickets/${t.id}/admin-done`, t.a.cookie)).statusCode).toBe(
        200,
      );
      expect(
        (await call('PATCH', `/api/messages/${sent.id}`, t.z.cookie, { body: 'Upravená' }))
          .statusCode,
      ).toBe(200);
      expect((await rowOf(t.id)).adminDoneAt).not.toBeNull();
      expect(
        (await call('DELETE', `/api/messages/${sent.id}`, t.z.cookie)).statusCode,
      ).toBeLessThan(300);
      const row = await rowOf(t.id);
      expect(row.adminDoneAt).not.toBeNull();
      expect(row.adminDoneClearedAt).toBeNull();
    });

    it('a repeated send with the same clientId does not clear a mark set after the first', async () => {
      const t = await markedTicket();
      const clientId = randomUUID();
      await send(t.chat.id, t.z.cookie, { body: 'Raz', clientId });
      expect((await call('POST', `/api/tickets/${t.id}/admin-done`, t.a.cookie)).statusCode).toBe(
        200,
      );
      expect((await send(t.chat.id, t.z.cookie, { body: 'Raz', clientId })).statusCode).toBe(200);
      expect((await rowOf(t.id)).adminDoneAt).not.toBeNull();
    });

    it('a ticket without the mark writes nothing', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const id = await ticket(g, z.email);
      const chat = await chatOf(id, z.cookie);
      const before = await rowOf(id);
      await send(chat.id, z.cookie, { body: 'Ahoj' });
      expect((await rowOf(id)).updatedAt).toEqual(before.updatedAt);
    });
  });
});
