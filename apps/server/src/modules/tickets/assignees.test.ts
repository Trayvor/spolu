import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { TicketCandidate, TicketDto, TicketListResponse } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addManager, removeManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { setGroupMode } from '../notifications/modes.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';

const KEY = 'test-tickets-key-assignees-0123';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `a${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('ticket riešitelia and watching tickets', () => {
  let test: TestApp;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
  });
  afterAll(async () => {
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

  async function group() {
    const h = host();
    return {
      ...(await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` })),
      host: h,
    };
  }
  async function admin(name = 'Ad Min') {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel', name = 'Jana') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name, emailVerified: true }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, name, cookie: await loginAs(test.app, c.email) };
  }
  async function ticket(g: { host: string } | null, email?: string) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        subject: 'Login fails',
        email,
        ...(g ? { instance_url: `https://${g.host}.egrant.sk` } : {}),
      },
    });
    return res.json<{ id: string; number: number }>();
  }
  const assign = (ticketId: string, userId: string, cookie: string) =>
    call('PUT', `/api/tickets/${ticketId}/assignees/${userId}`, cookie);
  const unassign = (ticketId: string, userId: string, cookie: string) =>
    call('DELETE', `/api/tickets/${ticketId}/assignees/${userId}`, cookie);
  const eventsOf = (ticketId: string, userIds: string[]) =>
    db()
      .select()
      .from(notificationEvents)
      .where(
        and(
          inArray(notificationEvents.userId, userIds),
          sql`${notificationEvents.payload}->>'ticketId' = ${ticketId}`,
        ),
      );
  describe('riešitelia', () => {
    it('an admin adds an admin: assigned and notified; removing notifies nobody', async () => {
      const g = await group();
      const [actor, other] = [await admin(), await admin('Zora')];
      const t = await ticket(g);
      const res = await assign(t.id, other.id, actor.cookie);
      expect(res.statusCode).toBe(200);
      const dto = res.json<TicketDto>();
      expect(dto.assignees).toEqual([{ id: other.id, name: 'Zora' }]);
      expect(dto.canAssign).toBe(true);
      const events = await eventsOf(t.id, [other.id, actor.id]);
      expect(events.map((e) => [e.userId, e.kind])).toEqual([[other.id, 'ticket.assigned']]);
      expect(events[0]!.payload).toMatchObject({ ticketId: t.id, number: t.number });

      // A second add changes nothing and notifies nobody again.
      expect((await assign(t.id, other.id, actor.cookie)).statusCode).toBe(200);
      expect(await eventsOf(t.id, [other.id])).toHaveLength(1);

      const removed = await unassign(t.id, other.id, actor.cookie);
      expect(removed.json<TicketDto>().assignees).toEqual([]);
      expect(await eventsOf(t.id, [other.id])).toHaveLength(1);
    });

    it('a client of the group assigns clients and admins, never a ziadatel or an outsider', async () => {
      const g = await group();
      const other = await group();
      const c = await member(g.id, 'client', 'Klára');
      const c2 = await member(g.id, 'client', 'Cyril');
      const z = await member(g.id, 'ziadatel', 'Žofia');
      const foreign = await member(other.id, 'client', 'Fero');
      const a = await admin('Adam');
      const t = await ticket(g, z.email);
      expect((await assign(t.id, c2.id, c.cookie)).statusCode).toBe(200);
      expect((await assign(t.id, a.id, c.cookie)).statusCode).toBe(200);
      for (const id of [z.id, foreign.id, randomUUID()]) {
        const res = await assign(t.id, id, c.cookie);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_assignee' });
      }
      const dto = (await call('GET', `/api/tickets/${t.id}`, c.cookie)).json<TicketDto>();
      expect(dto.assignees.map((p) => p.name)).toEqual(['Adam', 'Cyril']);
    });

    it('a ziadatel may not assign (403), an outsider gets 404, a requester sees the riešitelia', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const outsider = await member((await group()).id, 'client');
      const a = await admin();
      const t = await ticket(g, z.email);
      expect((await assign(t.id, a.id, z.cookie)).statusCode).toBe(403);
      expect((await unassign(t.id, a.id, z.cookie)).statusCode).toBe(403);
      expect(
        (await call('GET', `/api/tickets/${t.id}/assignee-candidates`, z.cookie)).statusCode,
      ).toBe(403);
      expect((await assign(t.id, a.id, outsider.cookie)).statusCode).toBe(404);
      await assign(t.id, a.id, a.cookie);
      const dto = (await call('GET', `/api/tickets/${t.id}`, z.cookie)).json<TicketDto>();
      expect(dto.assignees.map((p) => p.id)).toEqual([a.id]);
      expect(dto.canAssign).toBe(false);
    });

    it('a ticket without a client takes admins only', async () => {
      const a = await admin();
      const g = await group();
      const c = await member(g.id, 'client');
      const t = await ticket(null);
      expect((await assign(t.id, a.id, a.cookie)).statusCode).toBe(200);
      expect((await assign(t.id, c.id, a.cookie)).statusCode).toBe(400);
      const candidates = (
        await call('GET', `/api/tickets/${t.id}/assignee-candidates`, a.cookie)
      ).json<TicketCandidate[]>();
      expect(candidates.every((p) => p.isAdmin)).toBe(true);
      expect(candidates.some((p) => p.id === a.id)).toBe(true);
    });

    it('the candidates are every admin and the clients of the group, not its ziadatelia', async () => {
      const g = await group();
      const c = await member(g.id, 'client', 'Klára');
      const z = await member(g.id, 'ziadatel', 'Žofia');
      const a = await admin('Adam');
      const t = await ticket(g, z.email);
      const res = await call('GET', `/api/tickets/${t.id}/assignee-candidates`, c.cookie);
      expect(res.statusCode).toBe(200);
      const candidates = res.json<TicketCandidate[]>();
      expect(candidates).toContainEqual({ id: c.id, name: 'Klára', isAdmin: false });
      expect(candidates).toContainEqual({ id: a.id, name: 'Adam', isAdmin: true });
      expect(candidates.some((p) => p.id === z.id)).toBe(false);
    });

    it('the lists show the riešitelia and filter by me and nobody', async () => {
      const g = await group();
      const a = await admin('Adam');
      const [mine, free] = [await ticket(g), await ticket(g)];
      await assign(mine.id, a.id, a.cookie);
      const list = (q: string) =>
        call('GET', `/api/groups/${g.id}/tickets${q}`, a.cookie).then((r) =>
          r.json<TicketListResponse>(),
        );
      const all = await list('');
      expect(all.items.find((i) => i.id === mine.id)?.assignees).toEqual([
        { id: a.id, name: 'Adam' },
      ]);
      expect(all.items.find((i) => i.id === free.id)?.assignees).toEqual([]);
      expect((await list('?assignee=me')).items.map((i) => i.id)).toEqual([mine.id]);
      expect((await list('?assignee=none')).items.map((i) => i.id)).toEqual([free.id]);
      const global = (
        await call('GET', `/api/tickets/global?scope=all&assignee=me`, a.cookie)
      ).json<TicketListResponse>();
      expect(global.items.map((i) => i.id)).toEqual([mine.id]);
      expect(
        (await call('GET', `/api/groups/${g.id}/tickets?assignee=x`, a.cookie)).statusCode,
      ).toBe(400);
    });

    it('moving the ticket drops the riešitelia who are clients of the old client only', async () => {
      const [g, h] = [await group(), await group()];
      const c = await member(g.id, 'client');
      const a = await admin();
      const t = await ticket(g);
      await assign(t.id, c.id, a.cookie);
      await assign(t.id, a.id, a.cookie);
      const moved = await call('PUT', `/api/tickets/${t.id}/group`, a.cookie, { groupId: h.id });
      expect(moved.json<TicketDto>().assignees.map((p) => p.id)).toEqual([a.id]);
    });

    it('a riešiteľ hears the ticket events even with the group mode Off', async () => {
      const g = await group();
      const c = await member(g.id, 'client');
      const a = await admin();
      await setGroupMode(db(), c.id, g.id, 'off');
      const t = await ticket(g);
      await assign(t.id, c.id, a.cookie);
      await call('PATCH', `/api/tickets/${t.id}`, a.cookie, { status: 'in_progress' });
      const kinds = (await eventsOf(t.id, [c.id])).map((e) => e.kind).sort();
      expect(kinds).toEqual(['ticket.assigned', 'ticket.created', 'ticket.status']);
    });
  });

  describe('watch tickets', () => {
    const watch = (groupId: string, cookie: string) =>
      call('GET', `/api/groups/${groupId}/ticket-watch`, cookie);
    const setWatch = (groupId: string, cookie: string, watching: boolean) =>
      call('PUT', `/api/groups/${groupId}/ticket-watch`, cookie, { watching });

    it('defaults: clients on, admins off, managers on while they manage', async () => {
      const g = await group();
      const c = await member(g.id, 'client');
      const a = await admin();
      expect((await watch(g.id, c.cookie)).json()).toEqual({ watching: true });
      expect((await watch(g.id, a.cookie)).json()).toEqual({ watching: false });
      await addManager(db(), g.id, a.id);
      expect((await watch(g.id, a.cookie)).json()).toEqual({ watching: true });
      await removeManager(db(), g.id, a.id);
      expect((await watch(g.id, a.cookie)).json()).toEqual({ watching: false });
    });

    it('a choice of the user stays, also when they stop or start managing', async () => {
      const g = await group();
      const a = await admin();
      await addManager(db(), g.id, a.id);
      expect((await setWatch(g.id, a.cookie, false)).json()).toEqual({ watching: false });
      await removeManager(db(), g.id, a.id);
      await addManager(db(), g.id, a.id);
      expect((await watch(g.id, a.cookie)).json()).toEqual({ watching: false });
      await setWatch(g.id, a.cookie, true);
      await removeManager(db(), g.id, a.id);
      expect((await watch(g.id, a.cookie)).json()).toEqual({ watching: true });
    });

    it('a ziadatel gets 403, an outsider 404, a bad body 400', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const outsider = await member((await group()).id, 'client');
      expect((await watch(g.id, z.cookie)).statusCode).toBe(403);
      expect((await setWatch(g.id, z.cookie, true)).statusCode).toBe(403);
      expect((await watch(g.id, outsider.cookie)).statusCode).toBe(404);
      const a = await admin();
      expect((await call('PUT', `/api/groups/${g.id}/ticket-watch`, a.cookie, {})).statusCode).toBe(
        400,
      );
    });

    it('a new ticket notifies the watchers only', async () => {
      const g = await group();
      const client = await member(g.id, 'client', 'On');
      const quiet = await member(g.id, 'client', 'Off');
      const z = await member(g.id, 'ziadatel', 'Žiadateľ');
      const [manager, quietManager, watcher, other] = [
        await admin(),
        await admin(),
        await admin(),
        await admin(),
      ];
      await addManager(db(), g.id, manager.id);
      await addManager(db(), g.id, quietManager.id);
      await setWatch(g.id, quietManager.cookie, false);
      await setWatch(g.id, quiet.cookie, false);
      await setWatch(g.id, watcher.cookie, true);
      const t = await ticket(g, z.email);
      const everyone = [client, quiet, z, manager, quietManager, watcher, other].map((p) => p.id);
      const created = (await eventsOf(t.id, everyone)).filter((e) => e.kind === 'ticket.created');
      expect(created.map((e) => e.userId).sort()).toEqual(
        [client.id, manager.id, watcher.id].sort(),
      );
    });
  });
});
