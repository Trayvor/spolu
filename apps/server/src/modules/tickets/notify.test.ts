import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GroupChannel } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { latestEmail } from '../../../test/mail.js';
import { addManager } from '../groups/managers.js';
import { addMembership, removeMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { sendDueDigests } from '../notifications/digest.js';
import { DELIVER_JOB } from '../notifications/service.js';
import { setGroupMode } from '../notifications/modes.js';
import { saveSubscription } from '../notifications/push-subscriptions.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setNotificationChannel,
} from '../users/service.js';
import { notifyTicketChange } from './notify.js';
import { getTicketRow } from './service.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `n${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('ticket notifications (Phase 21.6)', () => {
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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const send = (channelId: string, cookie: string, body: string) =>
    call('POST', `/api/channels/${channelId}/messages`, cookie, { clientId: randomUUID(), body });

  async function group() {
    const h = host();
    return {
      ...(await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` })),
      host: h,
    };
  }
  async function device(userId: string) {
    const endpoint = `https://push.example.test/${randomUUID()}`;
    await saveSubscription(db(), userId, { endpoint, p256dh: 'pk', auth: 'au', userAgent: null });
    return endpoint;
  }
  // Only the admins who act need a session: each login is two requests and an email, and most
  // admins here only have to be there. They need only an id and a push endpoint.
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, endpoint: await device(a.id) };
  }
  async function signedInAdmin() {
    const a = await admin();
    return { ...a, cookie: await loginAs(test.app, a.email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel', name = 'Jana') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    // A client still logs in: the first login verifies the address, and only verified clients hear.
    return { ...c, name, cookie: await loginAs(test.app, c.email), endpoint: await device(c.id) };
  }
  async function ticket(g: { host: string } | null, email?: string, subject = 'Login fails') {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject, email, ...(g ? { instance_url: `https://${g.host}.egrant.sk` } : {}) },
    });
    return res.json<{ id: string; number: number }>();
  }
  const chatOf = async (ticketId: string, cookie: string) =>
    (await call('GET', `/api/tickets/${ticketId}/chat`, cookie)).json<GroupChannel>();
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
  // Delivery runs inline before the request returns, scoped to the events this file recorded
  // (`scopedDelivery`): no other test file delivers them, so pushes are checked without waiting.
  const pushesTo = (endpoint: string) =>
    test.push.sent.filter((s) => s.endpoint === endpoint).map((s) => s.payload);

  it('ticket.created reaches the managers (they watch by default) with the ticket in the payload', async () => {
    const g = await group();
    const m = await admin();
    await addManager(db(), g.id, m.id);
    const t = await ticket(g);
    const [event] = await eventsOf(t.id, [m.id]);
    expect(event).toMatchObject({
      kind: 'ticket.created',
      groupId: g.id,
      payload: { ticketId: t.id, number: t.number, subject: 'Login fails' },
    });
    expect(pushesTo(m.endpoint)).toEqual([
      {
        title: `Nový tiket #${t.number} · Firma`,
        body: 'Login fails',
        url: `/tickets/${t.id}`,
        tag: `ticket:${t.id}`,
        renotify: true,
      },
    ]);
  });

  it('ticket.unassigned reaches every admin with groupId null', async () => {
    const [a1, a2] = [await admin(), await admin()];
    const t = await ticket(null);
    const events = await eventsOf(t.id, [a1.id, a2.id]);
    expect(events.map((e) => [e.kind, e.groupId]).sort()).toEqual([
      ['ticket.unassigned', null],
      ['ticket.unassigned', null],
    ]);
    // Every active admin of the shared database gets this event; this file delivers only its own
    // events, so each of ours gets exactly one push for this ticket.
    for (const a of [a1, a2]) {
      expect(pushesTo(a.endpoint).filter((p) => p.url === `/tickets/${t.id}`)).toHaveLength(1);
    }
  });

  const assign = (ticketId: string, userId: string, cookie: string) =>
    call('PUT', `/api/tickets/${ticketId}/assignees/${userId}`, cookie);
  const unassign = (ticketId: string, userId: string, cookie: string) =>
    test.app.inject({
      method: 'DELETE',
      url: `/api/tickets/${ticketId}/assignees/${userId}`,
      headers: { cookie },
    });
  const setWatch = (groupId: string, cookie: string, watching: boolean) =>
    call('PUT', `/api/groups/${groupId}/ticket-watch`, cookie, { watching });
  const kindsFor = async (ticketId: string, userIds: string[], kind: string) =>
    (await eventsOf(ticketId, userIds))
      .filter((e) => e.kind === kind)
      .map((e) => e.userId)
      .sort();

  describe('who hears a ticket update (owner decision 2026-10-17)', () => {
    it('without a riešiteľ: the watchers and the initiator, never the actor or a non-watcher', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const c = await member(g.id, 'client', 'Klient');
      const quiet = await member(g.id, 'client', 'Tichý');
      const [m, actor, other] = [await admin(), await signedInAdmin(), await admin()];
      await addManager(db(), g.id, m.id);
      await addManager(db(), g.id, actor.id);
      await setWatch(g.id, quiet.cookie, false);
      const t = await ticket(g, z.email);
      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { status: 'in_progress' });
      const everyone = [z, c, quiet, m, actor, other].map((p) => p.id);
      expect(await kindsFor(t.id, everyone, 'ticket.status')).toEqual([z.id, c.id, m.id].sort());
      const [event] = (await eventsOf(t.id, [z.id])).filter((e) => e.kind === 'ticket.status');
      expect(event!.payload).toMatchObject({ status: 'in_progress', number: t.number });
      expect(pushesTo(z.endpoint).map((p) => p.title)).toContain(
        `Tiket #${t.number}: stav „V riešení“`,
      );

      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { subject: 'Nové' });
      expect(await kindsFor(t.id, everyone, 'ticket.updated')).toEqual([z.id, c.id, m.id].sort());
    });

    it('with a riešiteľ: only the riešitelia and the initiator; removing the last one falls back', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const c = await member(g.id, 'client', 'Klient');
      const [m, r, actor] = [await admin(), await signedInAdmin(), await signedInAdmin()];
      await addManager(db(), g.id, m.id);
      const t = await ticket(g, z.email);
      expect((await assign(t.id, r.id, actor.cookie)).statusCode).toBe(200);
      const everyone = [z, c, m, r, actor].map((p) => p.id);
      expect(await kindsFor(t.id, everyone, 'ticket.assigned')).toEqual([r.id]);

      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { status: 'in_progress' });
      expect(await kindsFor(t.id, everyone, 'ticket.status')).toEqual([z.id, r.id].sort());

      // The riešiteľ makes the change: only the initiator hears it.
      await call('PATCH', `/api/tickets/${t.id}`, r.cookie, { subject: 'Nové' });
      expect(await kindsFor(t.id, everyone, 'ticket.updated')).toEqual([z.id]);

      expect((await unassign(t.id, r.id, actor.cookie)).statusCode).toBe(200);
      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { status: 'resolved' });
      expect(await kindsFor(t.id, everyone, 'ticket.resolved')).toEqual([z.id, c.id, m.id].sort());
    });

    it('resolving tells the riešitelia, the watchers and the initiator once, as ticket.resolved (2026-10-18)', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const c = await member(g.id, 'client', 'Klient');
      const quiet = await member(g.id, 'client', 'Tichý');
      const [m, r, actor, other] = [
        await admin(),
        await signedInAdmin(),
        await signedInAdmin(),
        await admin(),
      ];
      await addManager(db(), g.id, m.id);
      await setWatch(g.id, quiet.cookie, false);
      const t = await ticket(g, z.email);
      expect((await assign(t.id, r.id, actor.cookie)).statusCode).toBe(200);
      const everyone = [z, c, quiet, m, r, actor, other].map((p) => p.id);
      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { status: 'resolved' });
      // The watchers (c, m) hear the outcome too, though r answers the ticket; never the actor.
      expect(await kindsFor(t.id, everyone, 'ticket.resolved')).toEqual(
        [z.id, c.id, m.id, r.id].sort(),
      );
      expect(await kindsFor(t.id, everyone, 'ticket.status')).toEqual([]);
      expect(pushesTo(z.endpoint).map((p) => p.title)).toContain(`Tiket #${t.number} je vyriešený`);
      // Reopening is an ordinary status change again, for the people who answer it.
      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { status: 'in_progress' });
      expect(await kindsFor(t.id, everyone, 'ticket.status')).toEqual([z.id, r.id].sort());
    });

    it('a ticket without a client: every admin while it has no riešiteľ, then its riešitelia', async () => {
      const [a1, a2, actor] = [await admin(), await admin(), await signedInAdmin()];
      const t = await ticket(null);
      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { subject: 'Prvá' });
      const ours = [a1.id, a2.id, actor.id];
      expect(await kindsFor(t.id, ours, 'ticket.updated')).toEqual([a1.id, a2.id].sort());

      expect((await assign(t.id, a1.id, actor.cookie)).statusCode).toBe(200);
      await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { status: 'in_progress' });
      expect(await kindsFor(t.id, ours, 'ticket.status')).toEqual([a1.id]);
    });

    it('moving to another client: its watchers hear a new ticket while it has no riešiteľ, else the riešitelia hear the change', async () => {
      const [g1, g2] = [await group(), await group()];
      const c2 = await member(g2.id, 'client', 'Druhý');
      const [m1, m2, r, actor] = [
        await admin(),
        await admin(),
        await admin(),
        await signedInAdmin(),
      ];
      await addManager(db(), g1.id, m1.id);
      await addManager(db(), g2.id, m2.id);
      const everyone = [c2, m1, m2, r, actor].map((p) => p.id);

      const free = await ticket(g1);
      await call('PUT', `/api/tickets/${free.id}/group`, actor.cookie, { groupId: g2.id });
      expect(await kindsFor(free.id, everyone, 'ticket.created')).toEqual(
        [m1.id, m2.id, c2.id].sort(),
      );

      const owned = await ticket(g1);
      await assign(owned.id, r.id, actor.cookie);
      await call('PUT', `/api/tickets/${owned.id}/group`, actor.cookie, { groupId: g2.id });
      // m1 heard of the new ticket in g1 only; of the move only the riešiteľ hears.
      expect(await kindsFor(owned.id, everyone, 'ticket.created')).toEqual([m1.id]);
      expect(await kindsFor(owned.id, everyone, 'ticket.updated')).toEqual([r.id]);
    });

    it('a watcher removed from the group gets nothing', async () => {
      const g = await group();
      const a = await signedInAdmin();
      const c = await member(g.id, 'client');
      await member(g.id, 'client'); // c is not the last client: the account stays active
      const t = await ticket(g);
      await removeMembership(db(), g.id, c.id);
      await call('PATCH', `/api/tickets/${t.id}`, a.cookie, { status: 'resolved' });
      // The new ticket reached c as a watcher before; nothing after the removal.
      expect((await eventsOf(t.id, [c.id])).filter((e) => e.kind !== 'ticket.created')).toEqual([]);
    });
  });

  it('turning into tasks notifies the initiator with the count', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const a = await signedInAdmin();
    const t = await ticket(g, z.email);
    const row = (await getTicketRow(db(), t.id))!;
    await notifyTicketChange(test.deps, { kind: 'tasks', ticket: row, actorId: a.id, count: 2 });
    const [event] = (await eventsOf(t.id, [z.id])).filter((e) => e.kind === 'ticket.tasks');
    expect(event?.payload).toMatchObject({ count: 2 });
    expect(pushesTo(z.endpoint).map((p) => p.title)).toContain(
      `Tiket #${t.number}: vytvorené 2 úlohy`,
    );
  });

  it('a ziadatel initiator gets ticket.message even with the group mode Off', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel', 'Žiadateľ');
    const a = await signedInAdmin();
    await setGroupMode(db(), z.id, g.id, 'off');
    const t = await ticket(g, z.email);
    const chat = await chatOf(t.id, a.cookie);
    expect((await send(chat.id, a.cookie, 'Pozrieme sa')).statusCode).toBe(201);
    const [event] = (await eventsOf(t.id, [z.id, a.id])).filter((e) => e.kind === 'ticket.message');
    expect(event).toMatchObject({ userId: z.id, groupId: g.id });
    expect(pushesTo(z.endpoint)).toContainEqual({
      title: `#${t.number} Login fails`,
      body: 'Ad Min: Pozrieme sa',
      url: `/tickets/${t.id}`,
      tag: `ticket:${t.id}`,
      actions: [
        expect.objectContaining({
          action: 'reply',
          channelId: chat.id,
          url: expect.stringMatching(
            new RegExp(`^/tickets/${t.id}\\?message=.+&c=${chat.id}&reply=1$`),
          ),
        }),
      ],
    });
  });

  it('a ziadatel gets nothing from the group chat (membership counts for tickets only)', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const a = await signedInAdmin();
    const groupChat = (await call('GET', `/api/groups/${g.id}/chat`, a.cookie)).json<{
      id: string;
    }>();
    expect((await send(groupChat.id, a.cookie, 'Ahoj všetci')).statusCode).toBe(201);
    // Even an event recorded for them by mistake is not delivered: they are no group person.
    const eventId = randomUUID();
    await db()
      .insert(notificationEvents)
      .values({
        id: eventId,
        userId: z.id,
        groupId: g.id,
        kind: 'chat.message',
        payload: { channelId: groupChat.id, groupId: g.id, authorName: 'A', excerpt: 'x' },
      });
    await test.deps.jobs.send(DELIVER_JOB, { eventIds: [eventId] });
    const [row] = await db()
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.id, eventId));
    expect(row!.deliveredAt).toBeInstanceOf(Date);
    expect(pushesTo(z.endpoint)).toEqual([]);
  });

  it('a chat message goes to the watchers and the initiator while there is no riešiteľ', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const c = await member(g.id, 'client', 'Klient');
    const [a, other] = [await signedInAdmin(), await admin()];
    const t = await ticket(g, z.email);
    const chat = await chatOf(t.id, a.cookie);
    await send(chat.id, a.cookie, 'Pozrieme sa');
    expect(await kindsFor(t.id, [z.id, c.id, a.id, other.id], 'ticket.message')).toEqual(
      [z.id, c.id].sort(),
    );
  });

  it('with a riešiteľ a message reaches the riešitelia and the initiator; a named reader gets the mention', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const c = await member(g.id, 'client', 'Klient');
    const [a, r] = [await signedInAdmin(), await admin()];
    const t = await ticket(g, z.email);
    await assign(t.id, r.id, a.cookie);
    const chat = await chatOf(t.id, a.cookie);
    await send(chat.id, a.cookie, `<@${c.id}> <@${z.id}> pozrite`);
    const events = (await eventsOf(t.id, [c.id, z.id, r.id, a.id])).filter(
      (e) => e.kind === 'ticket.message' || e.kind === 'chat.mention',
    );
    expect(events.map((e) => [e.userId, e.kind]).sort()).toEqual(
      [
        [c.id, 'chat.mention'],
        [r.id, 'ticket.message'],
        [z.id, 'chat.mention'],
        [z.id, 'ticket.message'],
      ].sort(),
    );
    // The named client opens the ticket from the mention.
    expect(pushesTo(c.endpoint).filter((p) => !p.title.startsWith('Nový tiket'))).toEqual([
      {
        title: `#${t.number} Login fails`,
        body: 'Ad Min: @Klient @Jana pozrite',
        url: `/tickets/${t.id}`,
        tag: `ticket:${t.id}`,
        renotify: true,
        // N6a: "Reply" goes to the ticket chat.
        actions: [expect.objectContaining({ action: 'reply', channelId: chat.id, parentId: null })],
      },
    ]);
    // The initiator who is also named gets one push for the message.
    expect(pushesTo(z.endpoint)).toHaveLength(1);
  });

  it('@all in a ticket chat reaches the people who hear its updates', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const c = await member(g.id, 'client');
    const [a, r] = [await signedInAdmin(), await admin()];
    const t = await ticket(g, z.email);
    await assign(t.id, r.id, a.cookie);
    const chat = await chatOf(t.id, a.cookie);
    await send(chat.id, a.cookie, '<@all> pozor');
    expect(await kindsFor(t.id, [z.id, c.id, r.id], 'chat.mention')).toEqual([z.id, r.id].sort());
  });

  it('two tickets give one digest email with a section each (2026-10-18)', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    await setNotificationChannel(db(), z.id, 'tickets', 'email');
    const a = await signedInAdmin();
    const [t1, t2] = [await ticket(g, z.email, 'Prvý'), await ticket(g, z.email, 'Druhý')];
    for (const t of [t1, t2]) await send((await chatOf(t.id, a.cookie)).id, a.cookie, 'Odpoveď');
    const later = new Date(Date.now() + test.deps.config.emailBatchDelayMs + 1000);
    expect(await sendDueDigests(test.deps, { now: later, userIds: [z.id] })).toBe(1);
    const mail = await latestEmail(z.email);
    expect(mail.subject).toBe(`2 zmeny: Tiket #${t1.number}, Tiket #${t2.number}`);
    const text = mail.text.replaceAll('\r\n', '\n');
    expect(text).toContain(`/tickets/${t1.id}`);
    expect(text).toContain(`/tickets/${t2.id}`);
    expect(text.indexOf(`/tickets/${t1.id}`)).toBeLessThan(text.indexOf(`/tickets/${t2.id}`));
  });
});
