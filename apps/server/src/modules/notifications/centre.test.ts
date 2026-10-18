import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type {
  NotificationCentreState,
  NotificationPage,
  SendMessageInput,
  SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { FakePushSender } from '../../infra/push/index.js';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { deleteMessage, getMessage, sendMessage } from '../chat/messages.js';
import { ensureGroupChannel, type ChannelRow } from '../chat/service.js';
import { groupMembers } from '../groups/schema.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { deliverPending } from './deliver.js';
import { setGroupMode } from './modes.js';
import { saveSubscription } from './push-subscriptions.js';
import { notificationEvents } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

let test: TestApp;
let deps: AppDeps;
/** Writes go through this copy: nothing is delivered until a test calls `deliverPending`. */
let quiet: AppDeps;
let push: FakePushSender;
const admins: string[] = [];

beforeAll(async () => {
  test = await buildTestApp();
  ({ deps, push } = test);
  quiet = { ...deps, jobs: { send: async () => {} } };
});
afterAll(async () => {
  for (const id of admins) await deactivateUser(deps.db, id);
  await test.app.close();
  await test.close();
});

async function newClient(groupId: string, name = 'Anna') {
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await deps.db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(deps.db, groupId, id);
  return { id, cookie: await loginAs(test.app, email) };
}

async function subscribe(userId: string): Promise<string> {
  const endpoint = `https://push.example.test/${randomUUID()}`;
  await saveSubscription(deps.db, userId, { endpoint, p256dh: 'pk', auth: 'au', userAgent: null });
  return endpoint;
}

async function setup() {
  const group = await createGroup(deps.db, {
    name: `Firma ${randomUUID().slice(0, 8)}`,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const channel = await ensureGroupChannel(deps.db, group.id);
  const row = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name: 'Admin' });
  admins.push(row.id);
  const admin = { id: row.id, email: row.email, name: 'Admin', role: 'admin' } as SessionUser;
  const client = await newClient(group.id);
  return { group, channel, admin, client };
}

const send = async (channel: ChannelRow, author: SessionUser, body = 'Ahoj') =>
  (
    await sendMessage(quiet, {
      channel,
      author,
      data: { body, clientId: randomUUID() } as SendMessageInput,
    })
  ).message;

const get = (url: string, cookie: string) =>
  test.app.inject({ method: 'GET', url, headers: { cookie } });
const send204 = (method: 'POST' | 'PUT', url: string, cookie: string, payload?: object) =>
  test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

const list = async (cookie: string, query = '') => {
  const res = await get(`/api/me/notifications${query}`, cookie);
  expect(res.statusCode).toBe(200);
  return res.json<NotificationPage>();
};
const state = async (cookie: string) => {
  const res = await get('/api/me/notifications/state', cookie);
  expect(res.statusCode).toBe(200);
  return res.json<NotificationCentreState>();
};
const eventsOf = (userId: string) =>
  deps.db.select().from(notificationEvents).where(eq(notificationEvents.userId, userId));
const sentTo = (endpoint: string) => push.sent.filter((s) => s.endpoint === endpoint);

describe('notification centre API', () => {
  it('needs a login', async () => {
    const res = await test.app.inject({ method: 'GET', url: '/api/me/notifications' });
    expect(res.statusCode).toBe(401);
  });

  it('lists what the person was notified about, newest first, unread until marked read', async () => {
    const s = await setup();
    await subscribe(s.client.id);
    const first = await send(s.channel, s.admin, 'Prvá');
    const second = await send(s.channel, s.admin, 'Druhá');
    await deliverPending(deps, { userIds: [s.client.id] });

    const page = await list(s.client.cookie);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((i) => i.body)).toEqual(['Admin: Druhá', 'Admin: Prvá']);
    expect(page.items[0]).toMatchObject({
      kind: 'chat.message',
      title: s.group.name,
      url: `/groups/${s.group.id}/chat?message=${second.id}`,
      unread: true,
    });
    expect(page.items[1]!.url).toContain(first.id);
    expect(await state(s.client.cookie)).toEqual({ unread: 2, snoozedUntil: null });

    const read = await send204('POST', '/api/me/notifications/read', s.client.cookie);
    expect(read.statusCode).toBe(204);
    expect(await state(s.client.cookie)).toEqual({ unread: 0, snoozedUntil: null });
    expect((await list(s.client.cookie)).items.map((i) => i.unread)).toEqual([false, false]);

    // Another person's list does not hold them.
    const other = await newClient(s.group.id, 'Boris');
    expect((await list(other.cookie)).items).toEqual([]);
  });

  it('pages with a cursor', async () => {
    const s = await setup();
    await subscribe(s.client.id);
    for (const body of ['a', 'b', 'c']) await send(s.channel, s.admin, body);
    await deliverPending(deps, { userIds: [s.client.id] });
    const one = await list(s.client.cookie, '?limit=2');
    expect(one.items.map((i) => i.body)).toEqual(['Admin: c', 'Admin: b']);
    expect(one.nextCursor).not.toBeNull();
    const two = await list(s.client.cookie, `?limit=2&cursor=${one.nextCursor}`);
    expect(two.items.map((i) => i.body)).toEqual(['Admin: a']);
    expect(two.nextCursor).toBeNull();
    const bad = await get('/api/me/notifications?cursor=nonsense', s.client.cookie);
    expect(bad.statusCode).toBe(400);
  });

  it('leaves out what the mode filtered, a deleted message and a group the client left', async () => {
    const s = await setup();
    await subscribe(s.client.id);
    await setGroupMode(deps.db, s.client.id, s.group.id, 'off');
    await send(s.channel, s.admin, 'Ticho');
    await deliverPending(deps, { userIds: [s.client.id] });
    expect((await list(s.client.cookie)).items).toEqual([]);
    const [muted] = await eventsOf(s.client.id);
    expect(muted!.inCentre).toBe(false);

    await setGroupMode(deps.db, s.client.id, s.group.id, 'all');
    const gone = await send(s.channel, s.admin, 'Zmažem');
    await send(s.channel, s.admin, 'Ostane');
    await deliverPending(deps, { userIds: [s.client.id] });
    await deleteMessage(quiet, {
      message: (await getMessage(deps.db, gone.id))!,
      channel: s.channel,
    });
    expect((await list(s.client.cookie)).items.map((i) => i.body)).toEqual(['Admin: Ostane']);

    await deps.db
      .update(groupMembers)
      .set({ removedAt: new Date() })
      .where(and(eq(groupMembers.userId, s.client.id), eq(groupMembers.groupId, s.group.id)));
    expect((await list(s.client.cookie)).items).toEqual([]);
  });

  it('holds a push for someone without a device, then sends it once a device appears (N7)', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Čakám');
    await deliverPending(deps, { userIds: [s.client.id] });
    const [held] = await eventsOf(s.client.id);
    expect(held).toMatchObject({ deliveredAt: null, inCentre: true });
    // Listed at once, whether or not a push went out.
    expect((await list(s.client.cookie)).items.map((i) => i.body)).toEqual(['Admin: Čakám']);

    const endpoint = await subscribe(s.client.id);
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(sentTo(endpoint)).toHaveLength(1);
    const [done] = await eventsOf(s.client.id);
    expect(done!.deliveredAt).toBeInstanceOf(Date);
    expect(done!.inCentre).toBe(true);
  });

  it('closes a held event after 24 hours without a push', async () => {
    const s = await setup();
    await send(s.channel, s.admin);
    await deliverPending(deps, { userIds: [s.client.id] });
    await deps.db
      .update(notificationEvents)
      .set({ createdAt: sql`now() - interval '25 hours'` })
      .where(eq(notificationEvents.userId, s.client.id));
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(1);
    const [row] = await eventsOf(s.client.id);
    expect(row!.deliveredAt).toBeInstanceOf(Date);
    // A later run finds nothing to do for it.
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(0);
  });

  it('snooze silences pushes but keeps the list, and ends on request', async () => {
    const s = await setup();
    const endpoint = await subscribe(s.client.id);
    const before = Date.now();
    const res = await send204('PUT', '/api/me/notifications/snooze', s.client.cookie, {
      for: 'hour',
    });
    expect(res.statusCode).toBe(200);
    const until = Date.parse(res.json<NotificationCentreState>().snoozedUntil!);
    expect(until - before).toBeGreaterThan(59 * 60_000);
    expect(until - before).toBeLessThan(61 * 60_000);

    await send(s.channel, s.admin, 'Potichu');
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(sentTo(endpoint)).toHaveLength(0);
    expect((await list(s.client.cookie)).items.map((i) => i.body)).toEqual(['Admin: Potichu']);

    const end = await send204('PUT', '/api/me/notifications/snooze', s.client.cookie, {
      for: null,
    });
    expect(end.json<NotificationCentreState>().snoozedUntil).toBeNull();
    await send(s.channel, s.admin, 'Nahlas');
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(sentTo(endpoint)).toHaveLength(1);
  });

  it('snoozes until 08:00 tomorrow in Bratislava, or for a week', async () => {
    const s = await setup();
    const tomorrow = await send204('PUT', '/api/me/notifications/snooze', s.client.cookie, {
      for: 'tomorrow',
    });
    const at = new Date(tomorrow.json<NotificationCentreState>().snoozedUntil!);
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Bratislava',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at);
    expect(clock).toBe('08:00');
    expect(at.getTime() - Date.now()).toBeGreaterThan(0);
    expect(at.getTime() - Date.now()).toBeLessThan(33 * 3600_000);
    const week = await send204('PUT', '/api/me/notifications/snooze', s.client.cookie, {
      for: 'week',
    });
    const days =
      (Date.parse(week.json<NotificationCentreState>().snoozedUntil!) - Date.now()) / 864e5;
    expect(Math.round(days)).toBe(7);
    const bad = await send204('PUT', '/api/me/notifications/snooze', s.client.cookie, {
      for: 'year',
    });
    expect(bad.statusCode).toBe(400);
  });
});
