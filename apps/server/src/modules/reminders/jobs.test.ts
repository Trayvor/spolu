import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { FakePushSender } from '../../infra/push/index.js';
import { buildTestApp } from '../../../test/test-app.js';
import { groupMembers } from '../groups/schema.js';
import { addMember, createGroup } from '../groups/service.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { createItem } from '../knowledge/service.js';
import { deliverPending } from '../notifications/deliver.js';
import { setGroupMode } from '../notifications/modes.js';
import { saveSubscription } from '../notifications/push-subscriptions.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { fireDueReminders } from './jobs.js';
import { reminderSets, reminderTimes } from './schema.js';

let deps: AppDeps;
let push: FakePushSender;
let close: () => Promise<void>;
const admins: string[] = [];
beforeAll(async () => {
  ({ deps, push, close } = await buildTestApp({
    config: { push: { provider: 'fake' } } as never,
  }));
});
afterAll(async () => {
  for (const id of admins) await deactivateUser(deps.db, id);
  await close();
});

const HOUR = 60 * 60_000;

async function newAdmin(): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const row = await addAdmin(deps.db, { email, name: 'Ada' });
  admins.push(row.id);
  return { id: row.id, email, name: 'Ada', role: 'admin' };
}

async function newClient(groupId: string): Promise<SessionUser> {
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await deps.db
    .insert(user)
    .values({ id, email, name: 'Cleo', role: 'client', emailVerified: true, language: 'en' });
  await addMember(deps.db, groupId, id);
  await saveSubscription(deps.db, id, {
    endpoint: `https://push.example.test/${randomUUID()}`,
    p256dh: 'pk',
    auth: 'au',
    userAgent: null,
  });
  return { id, email, name: 'Cleo', role: 'client' };
}

/** A reminder item whose first time is moved into the past by `agoMs`. */
async function setup(opts: { agoMs?: number; extra?: string[] } = {}) {
  const group = await createGroup(deps.db, {
    name: `Firma ${randomUUID().slice(0, 8)}`,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
  const admin = await newAdmin();
  const client = await newClient(group.id);
  const { item } = await createItem({ db: deps.db }, admin, group.id, {
    type: 'reminder',
    title: 'Renew contract',
    body: '',
    visibility: 'public',
    fileIds: [],
    reminder: {
      times: [{ at: new Date(Date.now() + 2 * HOUR).toISOString() }],
      recipientIds: [client.id, ...(opts.extra ?? [])],
    },
  });
  const [set] = await deps.db
    .select()
    .from(reminderSets)
    .where(eq(reminderSets.knowledgeItemId, item.id));
  const [time] = await deps.db.select().from(reminderTimes).where(eq(reminderTimes.setId, set!.id));
  await deps.db
    .update(reminderTimes)
    .set({ at: new Date(Date.now() - (opts.agoMs ?? 30_000)) })
    .where(eq(reminderTimes.id, time!.id));
  return { group, admin, client, item, setId: set!.id, timeId: time!.id };
}

const eventsOf = (timeId: string) =>
  deps.db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.dedupeKey, `reminder:${timeId}`));

const pushesFor = (itemId: string) => push.sent.filter((p) => p.payload.url.includes(itemId));

const fire = (setId: string) => fireDueReminders(deps, { setIds: [setId] });

describe('reminders.fire', () => {
  it('due times record one event per recipient and set fired_at', async () => {
    const s = await setup();
    expect(await fire(s.setId)).toBe(1);
    const events = await eventsOf(s.timeId);
    expect(events.map((e) => e.userId).sort()).toEqual([s.admin.id, s.client.id].sort());
    expect(events.every((e) => e.kind === 'reminder.due')).toBe(true);
    const [time] = await deps.db.select().from(reminderTimes).where(eq(reminderTimes.id, s.timeId));
    expect(time!.firedAt).not.toBeNull();
  });

  it('a rerun records nothing', async () => {
    const s = await setup();
    await fire(s.setId);
    await deps.db
      .update(reminderTimes)
      .set({ firedAt: null })
      .where(eq(reminderTimes.id, s.timeId));
    await fire(s.setId);
    expect(await eventsOf(s.timeId)).toHaveLength(2);
  });

  it('two workers in parallel never double-fire', async () => {
    const s = await setup();
    const [a, b] = await Promise.all([fire(s.setId), fire(s.setId)]);
    expect(a + b).toBe(1);
    expect(await eventsOf(s.timeId)).toHaveLength(2);
  });

  it('times older than 24 h are marked fired silently', async () => {
    const s = await setup({ agoMs: 25 * HOUR });
    expect(await fire(s.setId)).toBe(1);
    expect(await eventsOf(s.timeId)).toHaveLength(0);
    const [time] = await deps.db.select().from(reminderTimes).where(eq(reminderTimes.id, s.timeId));
    expect(time!.firedAt).not.toBeNull();
  });

  it('a non-admin recipient of an admins-only subject is skipped', async () => {
    // The client subscribed while the item was public; it became admins-only since.
    const s = await setup();
    await deps.db
      .update(knowledgeItems)
      .set({ visibility: 'admins' })
      .where(eq(knowledgeItems.id, s.item.id));
    await fire(s.setId);
    expect((await eventsOf(s.timeId)).map((e) => e.userId)).toEqual([s.admin.id]);
  });

  it('a removed group member gets no push', async () => {
    const s = await setup();
    await deps.db.delete(groupMembers).where(eq(groupMembers.userId, s.client.id));
    await fire(s.setId);
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(pushesFor(s.item.id)).toHaveLength(0);
  });

  it('a recipient in mode Off still gets the push', async () => {
    const s = await setup();
    await setGroupMode(deps.db, s.client.id, s.group.id, 'off');
    await fire(s.setId); // requests delivery, which the inline queue runs for these users
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(pushesFor(s.item.id)).toHaveLength(1);
  });

  it('the push has title · group, Reminder for …, /groups/<g>/knowledge?k=<id>', async () => {
    const s = await setup();
    await fire(s.setId);
    await deliverPending(deps, { userIds: [s.client.id] });
    const sent = pushesFor(s.item.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.title).toBe(`Renew contract · ${s.group.name}`);
    expect(sent[0]!.payload.body).toMatch(/^Reminder for /);
    expect(sent[0]!.payload.url).toBe(`/groups/${s.group.id}/knowledge?k=${s.item.id}`);
  });
});
