import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { GroupChannel } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
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
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email), endpoint: await device(a.id) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel', name = 'Jana') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
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
  // Pushes go out after the events are written, so a positive check waits for them.
  const pushesTo = (endpoint: string) =>
    test.push.sent.filter((s) => s.endpoint === endpoint).map((s) => s.payload);

  it('ticket.created reaches the managers with the ticket in the payload', async () => {
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
    await vi.waitFor(() =>
      expect(pushesTo(m.endpoint)).toContainEqual({
        title: `Nový tiket #${t.number} · Firma`,
        body: 'Login fails',
        url: `/tickets/${t.id}`,
        tag: `ticket:${t.id}`,
      }),
    );
  });

  it('ticket.unassigned reaches every admin with groupId null', async () => {
    const [a1, a2] = [await admin(), await admin()];
    const t = await ticket(null);
    const events = await eventsOf(t.id, [a1.id, a2.id]);
    expect(events.map((e) => [e.kind, e.groupId]).sort()).toEqual([
      ['ticket.unassigned', null],
      ['ticket.unassigned', null],
    ]);
    await vi.waitFor(() =>
      expect(pushesTo(a1.endpoint).map((p) => p.title)).toContain(
        `Nový tiket #${t.number} bez klienta`,
      ),
    );
  });

  it('a status change notifies the followers but not the actor', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const [m, actor] = [await admin(), await admin()];
    await addManager(db(), g.id, m.id);
    const t = await ticket(g, z.email);
    await call('PUT', `/api/tickets/${t.id}/follow`, actor.cookie);
    await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { status: 'in_progress' });
    const events = (await eventsOf(t.id, [z.id, m.id, actor.id])).filter(
      (e) => e.kind === 'ticket.status',
    );
    expect(events.map((e) => e.userId).sort()).toEqual([z.id, m.id].sort());
    expect(events[0]!.payload).toMatchObject({ status: 'in_progress', number: t.number });
    await vi.waitFor(() =>
      expect(pushesTo(z.endpoint).map((p) => p.title)).toContain(`#${t.number} je teraz V riešení`),
    );

    await call('PATCH', `/api/tickets/${t.id}`, actor.cookie, { subject: 'Nové' });
    const updated = (await eventsOf(t.id, [z.id, actor.id])).filter(
      (e) => e.kind === 'ticket.updated',
    );
    expect(updated.map((e) => e.userId)).toEqual([z.id]);
  });

  it('a follower removed from the group gets nothing', async () => {
    const g = await group();
    const a = await admin();
    const c = await member(g.id, 'client');
    await member(g.id, 'client'); // c is not the last client: the account stays active
    const t = await ticket(g);
    await call('PUT', `/api/tickets/${t.id}/follow`, c.cookie);
    await removeMembership(db(), g.id, c.id);
    await call('PATCH', `/api/tickets/${t.id}`, a.cookie, { status: 'resolved' });
    expect(await eventsOf(t.id, [c.id])).toEqual([]);
  });

  it('turning into tasks notifies the followers with the count', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const a = await admin();
    const t = await ticket(g, z.email);
    const row = (await getTicketRow(db(), t.id))!;
    await notifyTicketChange(test.deps, { kind: 'tasks', ticket: row, actorId: a.id, count: 2 });
    const [event] = (await eventsOf(t.id, [z.id])).filter((e) => e.kind === 'ticket.tasks');
    expect(event?.payload).toMatchObject({ count: 2 });
    await vi.waitFor(() =>
      expect(pushesTo(z.endpoint).map((p) => p.title)).toContain(
        `#${t.number} rozdelený na 2 úlohy`,
      ),
    );
  });

  it('a ziadatel follower gets ticket.message even with the group mode Off', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel', 'Žiadateľ');
    const a = await admin();
    await setGroupMode(db(), z.id, g.id, 'off');
    const t = await ticket(g, z.email);
    const chat = await chatOf(t.id, a.cookie);
    expect((await send(chat.id, a.cookie, 'Pozrieme sa')).statusCode).toBe(201);
    const [event] = (await eventsOf(t.id, [z.id, a.id])).filter((e) => e.kind === 'ticket.message');
    expect(event).toMatchObject({ userId: z.id, groupId: g.id });
    await vi.waitFor(() =>
      expect(pushesTo(z.endpoint)).toContainEqual({
        title: `#${t.number} Login fails`,
        body: 'Ad Min: Pozrieme sa',
        url: `/tickets/${t.id}`,
        tag: `ticket:${t.id}`,
      }),
    );
  });

  it('a ziadatel gets nothing from the group chat (membership counts for tickets only)', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const a = await admin();
    const groupChat = (await call('GET', `/api/groups/${g.id}/chat`, a.cookie)).json<{
      id: string;
    }>();
    expect((await send(groupChat.id, a.cookie, 'Ahoj všetci')).statusCode).toBe(201);
    // Even an event recorded for them by mistake is not delivered: they are no group person.
    await db()
      .insert(notificationEvents)
      .values({
        id: randomUUID(),
        userId: z.id,
        groupId: g.id,
        kind: 'chat.message',
        payload: { channelId: groupChat.id, groupId: g.id, authorName: 'A', excerpt: 'x' },
      });
    await test.deps.jobs.send(DELIVER_JOB, { userIds: [z.id] });
    expect(pushesTo(z.endpoint)).toEqual([]);
  });

  it('a mentioned reader who does not follow gets chat.mention linking to the ticket', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const c = await member(g.id, 'client', 'Klient');
    const a = await admin();
    const t = await ticket(g, z.email);
    const chat = await chatOf(t.id, a.cookie);
    await send(chat.id, a.cookie, `<@${c.id}> <@${z.id}> pozrite`);
    const events = await eventsOf(t.id, [c.id, z.id]);
    expect(events.map((e) => [e.userId, e.kind]).sort()).toEqual(
      [
        [c.id, 'chat.mention'],
        [z.id, 'chat.mention'],
        [z.id, 'ticket.message'],
      ].sort(),
    );
    await vi.waitFor(() =>
      expect(pushesTo(c.endpoint)).toEqual([
        {
          title: `#${t.number} Login fails`,
          body: 'Ad Min: @Klient @Jana pozrite',
          url: `/tickets/${t.id}`,
          tag: `ticket:${t.id}`,
        },
      ]),
    );
    // The follower who is also named gets one push for the message.
    await vi.waitFor(() => expect(pushesTo(z.endpoint)).toHaveLength(1));
  });

  it('@all in a ticket chat reaches its followers only', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    const c = await member(g.id, 'client');
    const a = await admin();
    const t = await ticket(g, z.email);
    const chat = await chatOf(t.id, a.cookie);
    await send(chat.id, a.cookie, '<@all> pozor');
    const mentions = (await eventsOf(t.id, [z.id, c.id])).filter((e) => e.kind === 'chat.mention');
    expect(mentions.map((e) => e.userId)).toEqual([z.id]);
  });

  it('two tickets give two digest emails', async () => {
    const g = await group();
    const z = await member(g.id, 'ziadatel');
    await setNotificationChannel(db(), z.id, 'tickets', 'email');
    const a = await admin();
    const [t1, t2] = [await ticket(g, z.email, 'Prvý'), await ticket(g, z.email, 'Druhý')];
    for (const t of [t1, t2]) await send((await chatOf(t.id, a.cookie)).id, a.cookie, 'Odpoveď');
    const later = new Date(Date.now() + test.deps.config.emailBatchDelayMs + 1000);
    expect(await sendDueDigests(test.deps, { now: later, userIds: [z.id] })).toBe(2);
  });
});
