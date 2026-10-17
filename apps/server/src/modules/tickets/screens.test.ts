import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  FileInfo,
  GroupChannel,
  Member,
  Mentions,
  SessionUser,
  TaskDetailDto,
  TicketDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { insertTask } from '../../../test/tasks.js';
import { groupRoom } from '../../infra/realtime/rooms.js';
import { addManager } from '../groups/managers.js';
import { getMentions } from '../home/mentions.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { tasks } from '../tasks/schema.js';
import { setGroupMode } from '../notifications/modes.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setNotificationChannel,
} from '../users/service.js';
import { user } from '../users/schema.js';

/** Server support the ticket screens of part 21.4 need. */

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `s${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('rest of a png'),
]);
const WEBP = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.from([4, 0, 0, 0]),
  Buffer.from('WEBPVP8 '),
]);

describe('ticket screens: server support', () => {
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
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const upload = (ticketId: string, cookie: string, body: Buffer = PNG) =>
    test.app.inject({
      method: 'POST',
      url: `/api/tickets/${ticketId}/files`,
      headers: { cookie, 'content-type': 'image/png', 'x-file-name': 'screen.png' },
      payload: body,
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

  describe('POST /api/tickets/:id/files', () => {
    it('a ziadatel uploads to own ticket, previews it, sends it in the chat and downloads it', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel', 'Žiadateľ');
      const id = await ticket(g, z.email);

      const res = await upload(id, z.cookie);
      expect(res.statusCode).toBe(201);
      const file = res.json<FileInfo>();

      const preview = await test.app.inject({
        method: 'PUT',
        url: `/api/files/${file.id}/preview`,
        headers: {
          cookie: z.cookie,
          'content-type': 'image/webp',
          'x-image-width': '100',
          'x-image-height': '50',
        },
        payload: WEBP,
      });
      expect(preview.statusCode).toBe(204);

      const chat = (await call('GET', `/api/tickets/${id}/chat`, z.cookie)).json<GroupChannel>();
      const sent = await call('POST', `/api/channels/${chat.id}/messages`, z.cookie, {
        clientId: randomUUID(),
        body: 'Screenshot',
        fileIds: [file.id],
      });
      expect(sent.statusCode).toBe(201);
      expect((await call('GET', `/api/files/${file.id}`, z.cookie)).statusCode).toBe(200);
    });

    it('someone who cannot read the ticket gets 404; a ticket without client 409 no_client', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const other = await member(g.id, 'ziadatel');
      const id = await ticket(g, z.email);
      expect((await upload(id, other.cookie)).statusCode).toBe(404);
      expect((await upload(randomUUID(), z.cookie)).statusCode).toBe(404);

      const a = await admin();
      const without = await ticket(null);
      const res = await upload(without, a.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'no_client' });
    });

    it('another user cannot set the preview of a file they cannot read', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const id = await ticket(g, z.email);
      const file = (await upload(id, z.cookie)).json<FileInfo>();
      const other = await member((await group()).id, 'client');
      const res = await test.app.inject({
        method: 'PUT',
        url: `/api/files/${file.id}/preview`,
        headers: {
          cookie: other.cookie,
          'content-type': 'image/webp',
          'x-image-width': '100',
          'x-image-height': '50',
        },
        payload: WEBP,
      });
      expect(res.statusCode).toBe(404);
    });
  });

  describe('ticket files from the manual form', () => {
    it('are listed on the ticket, readable by the initiator and survive a move', async () => {
      const g = await group();
      const a = await admin();
      const fileRes = await test.app.inject({
        method: 'POST',
        url: `/api/groups/${g.id}/files`,
        headers: { cookie: a.cookie, 'content-type': 'image/png', 'x-file-name': 'a.png' },
        payload: PNG,
      });
      const file = fileRes.json<FileInfo>();
      const email = newEmail();
      const created = await call('POST', '/api/tickets', a.cookie, {
        groupId: g.id,
        requesterEmail: email,
        requesterName: 'Jana',
        subject: 'S prílohou',
        fileIds: [file.id],
      });
      expect(created.statusCode).toBe(201);
      const dto = created.json<TicketDto>();
      expect(dto.files.map((f) => f.id)).toEqual([file.id]);

      const zCookie = await loginAs(test.app, email);
      expect((await call('GET', `/api/files/${file.id}`, zCookie)).statusCode).toBe(200);

      const g2 = await group();
      await call('PUT', `/api/tickets/${dto.id}/group`, a.cookie, { groupId: g2.id });
      const moved = (await call('GET', `/api/tickets/${dto.id}`, a.cookie)).json<TicketDto>();
      expect(moved.files.map((f) => f.id)).toEqual([file.id]);
    });
  });

  describe('the task line', () => {
    it('a task made from a ticket names it; other tasks have null', async () => {
      const g = await group();
      const a = await admin();
      const client = await member(g.id, 'client');
      const id = await ticket(g);
      const number = (await call('GET', `/api/tickets/${id}`, a.cookie)).json<TicketDto>().number;
      const taskId = await insertTask(db(), { groupId: g.id, createdBy: a.id });
      const plain = await insertTask(db(), { groupId: g.id, createdBy: a.id });
      await db().update(tasks).set({ sourceTicketId: id }).where(eq(tasks.id, taskId));

      const detail = (
        await call('GET', `/api/tasks/${taskId}`, client.cookie)
      ).json<TaskDetailDto>();
      expect(detail.sourceTicket).toEqual({ id, number, subject: 'Chyba' });
      const other = (await call('GET', `/api/tasks/${plain}`, client.cookie)).json<TaskDetailDto>();
      expect(other.sourceTicket).toBeNull();
    });
  });

  describe('mentions on the admin home', () => {
    it('a mention in a ticket chat carries the ticket id', async () => {
      const g = await group();
      const a = await admin();
      await addManager(db(), g.id, a.id); // a manager can be mentioned
      const client = await member(g.id, 'client');
      const id = await ticket(g);
      const chat = (await call('GET', `/api/tickets/${id}/chat`, a.cookie)).json<GroupChannel>();
      await call('POST', `/api/channels/${chat.id}/messages`, client.cookie, {
        clientId: randomUUID(),
        body: `<@${a.id}> pozrite sa`,
      });
      const mentions = (await call('GET', '/api/me/home/mentions', a.cookie)).json<Mentions>();
      expect(mentions.items[0]).toMatchObject({ channelId: chat.id, ticketId: id, taskId: null });
    });

    it('follows the ticket board channel, not the group mode (as delivery does)', async () => {
      const g = await group();
      const a = await admin();
      await addManager(db(), g.id, a.id);
      const client = await member(g.id, 'client');
      const id = await ticket(g);
      const chat = (await call('GET', `/api/tickets/${id}/chat`, a.cookie)).json<GroupChannel>();
      await call('POST', `/api/channels/${chat.id}/messages`, client.cookie, {
        clientId: randomUUID(),
        body: `<@${a.id}> pozrite sa`,
      });
      const listed = async () =>
        (await call('GET', '/api/me/home/mentions', a.cookie))
          .json<Mentions>()
          .items.some((i) => i.ticketId === id);
      await setGroupMode(db(), a.id, g.id, 'off');
      await setNotificationChannel(db(), a.id, 'chat', 'none');
      expect(await listed()).toBe(true);
      await setNotificationChannel(db(), a.id, 'tickets', 'none');
      expect(await listed()).toBe(false);
    });
  });

  describe('mentions of a moved ticket', () => {
    it('a viewer who no longer reads the ticket does not get its mention; an admin does', async () => {
      const [g, other] = [await group(), await group()];
      const a = await admin();
      await addManager(db(), g.id, a.id);
      const client = await member(g.id, 'client', 'Klient');
      const author = await member(g.id, 'client', 'Autor');
      const id = await ticket(g);
      const chat = (await call('GET', `/api/tickets/${id}/chat`, a.cookie)).json<GroupChannel>();
      for (const named of [a.id, client.id]) {
        await call('POST', `/api/channels/${chat.id}/messages`, author.cookie, {
          clientId: randomUUID(),
          body: `<@${named}> pozrite sa`,
        });
      }
      const viewer = { id: client.id, email: client.email, name: 'Klient', role: 'client' };
      const ticketIds = async (who: SessionUser) =>
        (await getMentions(db(), who)).items.map((i) => i.ticketId);
      expect(await ticketIds(viewer as SessionUser)).toEqual([id]);

      expect(
        (await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: other.id })).statusCode,
      ).toBe(200);
      const left = await getMentions(db(), viewer as SessionUser);
      expect(left.items.map((i) => i.ticketId)).not.toContain(id);
      expect(left.total).toBe(left.items.length);
      const adminView = (await call('GET', '/api/me/home/mentions', a.cookie)).json<Mentions>();
      expect(adminView.items.find((i) => i.ticketId === id)).toMatchObject({ groupId: other.id });
    });
  });

  describe('requesters of a group', () => {
    it('lists the ziadatel members (also before their first login) to admins and clients', async () => {
      const g = await group();
      const a = await admin();
      const client = await member(g.id, 'client', 'Klient');
      const z = await member(g.id, 'ziadatel', 'Žiadateľ');
      const fresh = await createUnverifiedClient(db(), newEmail());
      await addMembership(db(), fresh.id, g.id, 'ziadatel');

      const list = await call('GET', `/api/groups/${g.id}/requesters`, a.cookie);
      expect(list.statusCode).toBe(200);
      expect(
        list
          .json<Member[]>()
          .map((m) => m.id)
          .sort(),
      ).toEqual([z.id, fresh.id].sort());
      expect((await call('GET', `/api/groups/${g.id}/requesters`, client.cookie)).statusCode).toBe(
        200,
      );
      expect((await call('GET', `/api/groups/${g.id}/requesters`, z.cookie)).statusCode).toBe(404);
      expect(
        (await call('GET', `/api/groups/${g.id}/requesters/removed`, client.cookie)).statusCode,
      ).toBe(403);
    });

    it('remove and restore a requester; restoring never puts them in the group room', async () => {
      const g = await group();
      const second = await group();
      const a = await admin();
      const z = await member(g.id, 'ziadatel', 'Žiadateľ');
      // A membership elsewhere keeps the account active through the removal.
      await addMembership(db(), z.id, second.id, 'ziadatel');
      const socket = connect(baseUrl, {
        transports: ['websocket'],
        extraHeaders: { cookie: z.cookie },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((resolve) => socket.once('connect', () => resolve(null)));

      expect(
        (await call('DELETE', `/api/groups/${g.id}/members/${z.id}`, a.cookie)).statusCode,
      ).toBe(204);
      const removed = (await call('GET', `/api/groups/${g.id}/requesters/removed`, a.cookie)).json<
        Member[]
      >();
      expect(removed.map((m) => m.id)).toEqual([z.id]);
      expect(
        (await call('POST', `/api/groups/${g.id}/members/${z.id}/restore`, a.cookie)).statusCode,
      ).toBe(204);
      const inRoom = await test.app.io.in(groupRoom(g.id)).fetchSockets();
      expect(inRoom.map((s) => s.data.user.id)).not.toContain(z.id);
      const list = (await call('GET', `/api/groups/${g.id}/requesters`, a.cookie)).json<Member[]>();
      expect(list.map((m) => m.id)).toEqual([z.id]);
    });
  });
});
