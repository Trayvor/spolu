import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type { TicketDto, TicketListResponse } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { countEmailsTo, latestEmail } from '../../../test/mailpit.js';
import { addManager } from '../groups/managers.js';
import { addMembership, getMembership, listMemberships } from '../groups/memberships.js';
import { addMember, createGroup } from '../groups/service.js';
import {
  addAdmin,
  createUnverifiedClient,
  findUserByEmail,
  deactivateUser,
} from '../users/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from './schema.js';
import { getBoard } from '../tasks/service.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `t${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('tickets API', () => {
  let test: TestApp;
  // Deactivated in afterAll: a ticket without a client notifies every active admin of the
  // shared test database, so admins left active make later runs slower.
  const admins: string[] = [];
  let baseUrl = '';
  const sockets: Socket[] = [];
  let ip = 0;

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
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: object,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });
  const intake = (payload: object, key: string | null = KEY, from = `10.1.0.${++ip % 250}`) =>
    test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      remoteAddress: from,
      headers: key === null ? {} : { authorization: `Bearer ${key}` },
      payload,
    });

  async function group(name = 'Firma') {
    const h = host();
    const g = await createGroup(db(), { name, egrantUrl: `https://${h}.egrant.sk` });
    return { ...g, host: h };
  }
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function clientIn(groupId: string, role: 'client' | 'ziadatel' = 'client') {
    const c = await createUnverifiedClient(db(), newEmail());
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }

  describe('intake', () => {
    it('without the key is 401; with no key configured 503', async () => {
      expect((await intake({ subject: 'x' }, null)).statusCode).toBe(401);
      expect((await intake({ subject: 'x' }, 'wrong-key-wrong-key-wrong')).statusCode).toBe(401);
      const off = await buildTestApp();
      try {
        const res = await off.app.inject({
          method: 'POST',
          url: '/api/tickets/intake',
          headers: { authorization: `Bearer ${KEY}` },
          payload: { subject: 'x' },
        });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'intake_disabled' });
      } finally {
        await off.app.close();
        await off.close();
      }
    });

    it('a bad body is 400 naming the field', async () => {
      const res = await intake({ subject: 'x', due_date: '2026-13-01' });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed', fields: ['due_date'] });
      expect((await intake({ email: 'a@b.sk' })).statusCode).toBe(400);
    });

    it('the 61st request in a minute from one address is 429', async () => {
      const from = '10.9.9.1';
      // With a client and no managers, nobody is notified: a ticket without a client would
      // notify every admin of the test database 60 times.
      const g = await group();
      const body = { subject: 'x', instance_url: `https://${g.host}.egrant.sk` };
      for (let i = 0; i < 60; i++) expect((await intake(body, KEY, from)).statusCode).toBe(201);
      expect((await intake(body, KEY, from)).statusCode).toBe(429);
    });

    it('matches the instance link, makes the requester a ziadatel and emails them a login link', async () => {
      const g = await group();
      const manager = await admin();
      await addManager(db(), g.id, manager.id);
      const email = newEmail();
      const res = await intake({
        subject: 'Nejde odoslať žiadosť',
        body: 'Pri odoslaní sa zobrazí chyba.',
        email: ` ${email.toUpperCase()} `,
        requester_name: 'Jana Nová',
        instance_url: `https://WWW.${g.host}.egrant.sk/app/login`,
        file_links: ['https://files.egrant.sk/a.png'],
        due_date: '2026-11-01',
      });
      expect(res.statusCode).toBe(201);
      const { id, number } = res.json<{ id: string; number: number }>();
      const requester = await findUserByEmail(db(), email);
      expect((await getMembership(db(), requester!.id, g.id))?.role).toBe('ziadatel');

      const mail = await latestEmail(email);
      expect(mail.subject).toBe(`Tiket #${number} bol vytvorený: Nejde odoslať žiadosť`);
      expect(mail.text).toContain(`/login?redirect=${encodeURIComponent(`/tickets/${id}`)}`);

      const dto = (await call('GET', `/api/tickets/${id}`, manager.cookie)).json<TicketDto>();
      expect(dto).toMatchObject({
        groupId: g.id,
        status: 'new',
        source: 'api',
        requester: { userId: requester!.id, name: 'Jana Nová', email },
        fileLinks: ['https://files.egrant.sk/a.png'],
        dueDate: '2026-11-01',
        following: true, // the manager follows from the start
      });
    });

    it('a repeat with the same request_id answers the first ticket and does nothing else', async () => {
      const g = await group();
      const manager = await admin();
      await addManager(db(), g.id, manager.id);
      const email = newEmail();
      const requestId = `egrant-${randomUUID()}`;
      const body = {
        subject: 'Opakovaný',
        email,
        instance_url: `https://${g.host}.egrant.sk`,
        request_id: requestId,
      };
      const first = await intake(body);
      expect(first.statusCode).toBe(201);
      await latestEmail(email);
      // A retry may differ in content; the request id alone decides.
      const again = await intake({ ...body, subject: 'Iný predmet' });
      expect(again.statusCode).toBe(200);
      expect(again.json()).toEqual(first.json());

      const { id } = first.json<{ id: string }>();
      const rows = await db().select().from(tickets).where(eq(tickets.requestId, requestId));
      expect(rows.map((r) => [r.id, r.subject])).toEqual([[id, 'Opakovaný']]);
      const events = await db()
        .select()
        .from(notificationEvents)
        .where(
          and(
            eq(notificationEvents.userId, manager.id),
            sql`${notificationEvents.payload}->>'ticketId' = ${id}`,
          ),
        );
      expect(events).toHaveLength(1);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(await countEmailsTo(email)).toBe(1);
    });

    it('concurrent requests with one request_id make one ticket', async () => {
      const g = await group();
      const body = {
        subject: 'Súbežný',
        instance_url: `https://${g.host}.egrant.sk`,
        request_id: randomUUID(),
      };
      const answers = await Promise.all(Array.from({ length: 6 }, () => intake(body)));
      expect(answers.map((r) => r.statusCode).sort()).toEqual([200, 200, 200, 200, 200, 201]);
      expect(new Set(answers.map((r) => r.json<{ id: string }>().id)).size).toBe(1);
      const rows = await db().select().from(tickets).where(eq(tickets.requestId, body.request_id));
      expect(rows).toHaveLength(1);
    });

    it('no match: a ticket without client, only in the global view with scope none', async () => {
      const a = await admin();
      const email = newEmail();
      const res = await intake({
        subject: 'Bez klienta',
        email,
        instance_url: 'https://nobody.egrant.sk',
      });
      const { id } = res.json<{ id: string }>();
      expect(await findUserByEmail(db(), email)).toBeNull();
      expect(await countEmailsTo(email)).toBe(0);
      const none = (
        await call('GET', '/api/tickets/global?scope=none', a.cookie)
      ).json<TicketListResponse>();
      expect(none.items.map((t) => t.id)).toContain(id);
      const dto = (await call('GET', `/api/tickets/${id}`, a.cookie)).json<TicketDto>();
      expect(dto).toMatchObject({ groupId: null, instanceUrl: 'https://nobody.egrant.sk' });
    });
  });

  describe('reading', () => {
    it('a client reads every ticket of the group, a ziadatel only their own, others nothing', async () => {
      const g = await group();
      const other = await group();
      const client = await clientIn(g.id);
      const z = await clientIn(g.id, 'ziadatel');
      const stranger = await clientIn(other.id);
      const own = (
        await intake({
          subject: 'Moja',
          email: z.email,
          instance_url: `https://${g.host}.egrant.sk`,
        })
      ).json<{ id: string }>();
      const foreign = (
        await intake({
          subject: 'Cudzia',
          email: newEmail(),
          instance_url: `https://${g.host}.egrant.sk`,
        })
      ).json<{ id: string }>();

      const ids = async (cookie: string) =>
        (await call('GET', `/api/groups/${g.id}/tickets`, cookie))
          .json<TicketListResponse>()
          .items.map((t) => t.id);
      expect(await ids(client.cookie)).toEqual(expect.arrayContaining([own.id, foreign.id]));
      expect(await ids(z.cookie)).toEqual([own.id]);
      expect((await call('GET', `/api/groups/${g.id}/tickets`, stranger.cookie)).statusCode).toBe(
        404,
      );
      expect((await call('GET', `/api/tickets/${foreign.id}`, z.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/tickets/${own.id}`, z.cookie)).statusCode).toBe(200);
      expect((await call('GET', `/api/tickets/${own.id}`, stranger.cookie)).statusCode).toBe(404);
      // The ziadatel membership opens nothing else of the group.
      expect((await call('GET', `/api/groups/${g.id}/board`, z.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/groups/${g.id}/chat`, z.cookie)).statusCode).toBe(404);
      expect((await call('GET', '/api/tickets/global', client.cookie)).statusCode).toBe(403);
    });

    it('My tickets lists the tickets of two clients for one requester', async () => {
      const [a, b] = [await group('A'), await group('B')];
      const email = newEmail();
      const t1 = (
        await intake({ subject: '1', email, instance_url: `https://${a.host}.egrant.sk` })
      ).json<{ id: string }>();
      const t2 = (
        await intake({ subject: '2', email, instance_url: `https://${b.host}.egrant.sk` })
      ).json<{ id: string }>();
      const cookie = await loginAs(test.app, email);
      const mine = (await call('GET', '/api/tickets/mine', cookie)).json<TicketListResponse>();
      expect(mine.items.map((t) => t.id).sort()).toEqual([t1.id, t2.id].sort());
      expect(new Set(mine.items.map((t) => t.groupName))).toEqual(new Set(['A', 'B']));
      const requester = await findUserByEmail(db(), email);
      expect((await listMemberships(db(), requester!.id)).map((m) => m.role)).toEqual([
        'ziadatel',
        'ziadatel',
      ]);
    });

    it('filters by status, follows and pages with a cursor', async () => {
      const g = await group();
      const a = await admin();
      const made: string[] = [];
      for (let i = 0; i < 52; i++) {
        made.push(
          (await intake({ subject: `T${i}`, instance_url: `https://${g.host}.egrant.sk` })).json<{
            id: string;
          }>().id,
        );
      }
      const first = (
        await call('GET', `/api/groups/${g.id}/tickets`, a.cookie)
      ).json<TicketListResponse>();
      expect(first.items).toHaveLength(50);
      expect(first.items[0]!.id).toBe(made[51]);
      const second = (
        await call('GET', `/api/groups/${g.id}/tickets?cursor=${first.nextCursor}`, a.cookie)
      ).json<TicketListResponse>();
      expect(second.items.map((t) => t.id)).toEqual([made[1], made[0]]);
      expect(second.nextCursor).toBeNull();

      await call('PATCH', `/api/tickets/${made[0]}`, a.cookie, { status: 'resolved' });
      await call('PUT', `/api/tickets/${made[1]}/follow`, a.cookie);
      const resolved = (
        await call('GET', `/api/groups/${g.id}/tickets?status=resolved`, a.cookie)
      ).json<TicketListResponse>();
      expect(resolved.items.map((t) => t.id)).toEqual([made[0]]);
      const followed = (
        await call('GET', `/api/groups/${g.id}/tickets?following=true&status=all`, a.cookie)
      ).json<TicketListResponse>();
      expect(followed.items.map((t) => t.id)).toEqual([made[1]]);
      expect(
        (await call('GET', `/api/groups/${g.id}/tickets?cursor=bad`, a.cookie)).statusCode,
      ).toBe(400);
    });
  });

  describe('manual creation', () => {
    it('a client creates in their group as the initiator, without an email to themselves', async () => {
      const g = await group();
      const client = await clientIn(g.id);
      const before = await countEmailsTo(client.email);
      const res = await call('POST', '/api/tickets', client.cookie, {
        groupId: g.id,
        subject: 'Otázka',
        requesterEmail: 'other@x.sk',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<TicketDto>()).toMatchObject({
        source: 'manual',
        requester: { userId: client.id, email: client.email },
        following: true,
      });
      expect(await countEmailsTo(client.email)).toBe(before);
    });

    it('a ziadatel cannot create (403), a stranger gets 404', async () => {
      const g = await group();
      const z = await clientIn(g.id, 'ziadatel');
      const stranger = await clientIn((await group()).id);
      expect(
        (await call('POST', '/api/tickets', z.cookie, { groupId: g.id, subject: 'x' })).statusCode,
      ).toBe(403);
      expect(
        (await call('POST', '/api/tickets', stranger.cookie, { groupId: g.id, subject: 'x' }))
          .statusCode,
      ).toBe(404);
    });

    it('an admin creates for a new email: a ziadatel account, the email, the admin follows', async () => {
      const g = await group();
      const a = await admin();
      const email = newEmail();
      const res = await call('POST', '/api/tickets', a.cookie, {
        groupId: g.id,
        subject: 'Telefonát',
        requesterEmail: email,
        requesterName: 'Peter',
      });
      expect(res.statusCode).toBe(201);
      const dto = res.json<TicketDto>();
      expect(dto.following).toBe(true);
      expect((await latestEmail(email)).subject).toContain(`#${dto.number}`);
      const account = await findUserByEmail(db(), email);
      expect((await getMembership(db(), account!.id, g.id))?.role).toBe('ziadatel');
    });
  });

  describe('changes', () => {
    it('only admins edit; resolving sets resolved_at, reopening clears it', async () => {
      const g = await group();
      const a = await admin();
      const client = await clientIn(g.id);
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g.host}.egrant.sk` })
      ).json<{ id: string }>();
      expect(
        (await call('PATCH', `/api/tickets/${id}`, client.cookie, { status: 'resolved' }))
          .statusCode,
      ).toBe(403);
      const stranger = await clientIn((await group()).id);
      expect(
        (await call('PATCH', `/api/tickets/${id}`, stranger.cookie, { status: 'resolved' }))
          .statusCode,
      ).toBe(404);
      const resolved = (
        await call('PATCH', `/api/tickets/${id}`, a.cookie, { status: 'resolved' })
      ).json<TicketDto>();
      expect(resolved.resolvedAt).not.toBeNull();
      const reopened = (
        await call('PATCH', `/api/tickets/${id}`, a.cookie, {
          status: 'in_progress',
          subject: 'Nový',
        })
      ).json<TicketDto>();
      expect(reopened).toMatchObject({ status: 'in_progress', resolvedAt: null, subject: 'Nový' });
    });

    it('assigning a client sends the email once; moving drops followers who cannot read it', async () => {
      const [g1, g2] = [await group(), await group()];
      const a = await admin();
      const email = newEmail();
      const { id } = (await intake({ subject: 'Kam?', email })).json<{ id: string }>();
      expect(await countEmailsTo(email)).toBe(0);

      expect(
        (await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g1.id })).statusCode,
      ).toBe(200);
      await latestEmail(email);
      expect(await countEmailsTo(email)).toBe(1);
      const requester = (await findUserByEmail(db(), email))!;
      const zCookie = await loginAs(test.app, email);

      // The ziadatel of the first client is told the ticket left, and loses it.
      const socket = connect(baseUrl, {
        transports: ['websocket'],
        extraHeaders: { cookie: zCookie },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((resolve) => socket.once('connect', () => resolve(null)));
      const moved = new Promise<unknown>((resolve) => socket.once('ticket:moved', resolve));
      const mailsBefore = await countEmailsTo(email);

      const res = await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g2.id });
      expect(res.statusCode).toBe(200);
      expect(await moved).toEqual({ ticketId: id, groupId: g1.id });
      expect(await countEmailsTo(email)).toBe(mailsBefore); // never a second "Ticket created"
      // Same email, so the requester is now the new client's ziadatel and still follows.
      expect((await getMembership(db(), requester.id, g2.id))?.role).toBe('ziadatel');
      const followers = (await call('GET', `/api/tickets/${id}/followers`, a.cookie)).json<
        { id: string }[]
      >();
      expect(followers.map((f) => f.id)).toContain(requester.id);
    });

    it('a follower of the old client who cannot read it in the new one is dropped', async () => {
      const [g1, g2] = [await group(), await group()];
      const a = await admin();
      const client = await clientIn(g1.id);
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g1.host}.egrant.sk` })
      ).json<{ id: string }>();
      expect((await call('PUT', `/api/tickets/${id}/follow`, client.cookie)).statusCode).toBe(204);
      await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g2.id });
      const followers = (await call('GET', `/api/tickets/${id}/followers`, a.cookie)).json<
        { id: string }[]
      >();
      expect(followers.map((f) => f.id)).not.toContain(client.id);
      expect((await call('GET', `/api/tickets/${id}`, client.cookie)).statusCode).toBe(404);
    });

    it('a ticket with tasks cannot move (409 has_tasks)', async () => {
      const [g1, g2] = [await group(), await group()];
      const a = await admin();
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g1.host}.egrant.sk` })
      ).json<{ id: string }>();
      const board = await getBoard(db(), g1.id);
      await db().insert(tasks).values({
        id: randomUUID(),
        groupId: g1.id,
        bucketId: board.buckets[0]!.id,
        position: 'a0',
        title: 'Z tiketu',
        createdBy: a.id,
        sourceTicketId: id,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const res = await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g2.id });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'has_tasks' });
    });

    it('follow and unfollow are idempotent and need read access', async () => {
      const g = await group();
      const client = await clientIn(g.id);
      await addMember(db(), g.id, client.id);
      const { id } = (
        await intake({ subject: 'x', instance_url: `https://${g.host}.egrant.sk` })
      ).json<{ id: string }>();
      for (let i = 0; i < 2; i++)
        expect((await call('PUT', `/api/tickets/${id}/follow`, client.cookie)).statusCode).toBe(
          204,
        );
      expect(
        (await call('GET', `/api/tickets/${id}`, client.cookie)).json<TicketDto>().following,
      ).toBe(true);
      for (let i = 0; i < 2; i++)
        expect((await call('DELETE', `/api/tickets/${id}/follow`, client.cookie)).statusCode).toBe(
          204,
        );
      expect(
        (await call('GET', `/api/tickets/${id}`, client.cookie)).json<TicketDto>().following,
      ).toBe(false);
      const stranger = await clientIn((await group()).id);
      expect((await call('PUT', `/api/tickets/${id}/follow`, stranger.cookie)).statusCode).toBe(
        404,
      );
    });
  });
});
