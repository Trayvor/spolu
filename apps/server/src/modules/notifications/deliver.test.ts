import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  mentionToken,
  TaskCreateSchema,
  type SendMessageInput,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createInlineJobs } from '../../infra/jobs/inline-jobs.js';
import { createDeferredQueue } from '../../infra/jobs/jobs.js';
import type { FakePushSender } from '../../infra/push/index.js';
import { buildTestApp } from '../../../test/test-app.js';
import { deleteMessage, getMessage, sendMessage } from '../chat/messages.js';
import { ensureGroupChannel, markRead, type ChannelRow } from '../chat/service.js';
import { groupMembers } from '../groups/schema.js';
import { addMember, createGroup } from '../groups/service.js';
import { listBuckets } from '../tasks/service.js';
import { createTask, moveTask } from '../tasks/task-service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, updateNotificationPrefs } from '../users/service.js';
import { deliverPending, sendPush } from './deliver.js';
import { DELIVER_JOB, notificationsJobHandlers } from './jobs.js';
import { setGroupMode } from './modes.js';
import { getSubscription, listSubscriptions, saveSubscription } from './push-subscriptions.js';
import { notificationEvents, pushSubscriptions } from './schema.js';

let deps: AppDeps;
/** Writes go through this copy: no delivery runs until a test calls `deliverPending`. */
let quiet: AppDeps;
let push: FakePushSender;
let close: () => Promise<void>;
beforeAll(async () => {
  const test = await buildTestApp();
  ({ deps, push, close } = test);
  quiet = { ...deps, jobs: { send: async () => {} } };
});
/** Admins are people of every group: deactivate ours so later sends elsewhere skip them. */
const admins: string[] = [];
afterAll(async () => {
  for (const id of admins) await deactivateUser(deps.db, id);
  await close();
});

const asSession = (id: string, name: string, role: 'client' | 'admin') =>
  ({ id, email: `${id}@example.com`, name, role }) as SessionUser;

async function newClient(groupId: string, name: string) {
  const id = randomUUID();
  await deps.db.insert(user).values({
    id,
    email: `${randomUUID()}@example.com`,
    name,
    role: 'client',
    emailVerified: true,
  });
  await addMember(deps.db, groupId, id);
  return asSession(id, name, 'client');
}

async function newAdmin(name = 'Admin') {
  const row = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name });
  admins.push(row.id);
  return asSession(row.id, name, 'admin');
}

async function subscribe(userId: string): Promise<string> {
  const endpoint = `https://push.example.test/${randomUUID()}`;
  await saveSubscription(deps.db, userId, { endpoint, p256dh: 'pk', auth: 'au', userAgent: null });
  return endpoint;
}

/** A group with an admin author and a subscribed client. */
async function setup() {
  const group = await createGroup(deps.db, {
    name: `Firma ${randomUUID().slice(0, 8)}`,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const channel = await ensureGroupChannel(deps.db, group.id);
  const admin = await newAdmin();
  const client = await newClient(group.id, 'Anna');
  const endpoint = await subscribe(client.id);
  return { group, channel, admin, client, endpoint };
}

const send = async (
  channel: ChannelRow,
  author: SessionUser,
  data: Partial<SendMessageInput> = {},
) =>
  (
    await sendMessage(quiet, {
      channel,
      author,
      data: { body: 'Ahoj', clientId: randomUUID(), ...data },
    })
  ).message;

const sentTo = (endpoint: string) => push.sent.filter((s) => s.endpoint === endpoint);

const eventsOf = (userId: string) =>
  deps.db.select().from(notificationEvents).where(eq(notificationEvents.userId, userId));

describe('deliverPending', () => {
  it('a client in mode all gets one push for an admin message', async () => {
    const s = await setup();
    const m = await send(s.channel, s.admin);
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(1);
    const sent = sentTo(s.endpoint);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({ title: s.group.name, body: 'Admin: Ahoj' });
    expect(sent[0]!.payload.url).toBe(`/groups/${s.group.id}/chat?message=${m.id}`);
    const [event] = await eventsOf(s.client.id);
    expect(event!.deliveredAt).toBeInstanceOf(Date);
    const [sub] = (await listSubscriptions(deps.db, [s.client.id])).get(s.client.id)!;
    expect(sub!.lastSuccessAt).toBeInstanceOf(Date);
    // Delivered once: a second run finds nothing.
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(0);
    expect(sentTo(s.endpoint)).toHaveLength(1);
  });

  it('an admin in default mode gets no push for a plain message but one for an @mention', async () => {
    const s = await setup();
    const admin2 = await newAdmin('Boris');
    const endpoint = await subscribe(admin2.id);
    // Admins are people of every group, so another test file's inline delivery may deliver this
    // admin's events (pushing to its own fake) before this test does, and a foreign @all may push
    // too. So: no push of this group may reach this fake for the plain message, and the mention
    // marks the subscription's success whichever process sent it.
    const mine = () =>
      sentTo(endpoint).filter((x) => x.payload.url.startsWith(`/groups/${s.group.id}/`));
    const delivered = async (messageId: string) => {
      await deliverPending(deps, { userIds: [admin2.id] });
      await vi.waitFor(async () => {
        const rows = (await eventsOf(admin2.id)).filter(
          (r) => (r.payload as { messageId?: string }).messageId === messageId,
        );
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.deliveredAt !== null)).toBe(true);
      });
    };

    const plain = await send(s.channel, s.client);
    await delivered(plain.id);
    expect(mine()).toHaveLength(0);

    const mention = await send(s.channel, s.client, { body: `Hi ${mentionToken(admin2.id)}` });
    await delivered(mention.id);
    await vi.waitFor(async () =>
      expect((await getSubscriptionByEndpoint(endpoint))!.lastSuccessAt).toBeInstanceOf(Date),
    );
    expect(mine().length).toBeLessThanOrEqual(1);
    for (const x of mine()) expect(x.payload.url).toContain(`message=${mention.id}`);
  });

  it('one push per message when mention and message coincide', async () => {
    const s = await setup();
    await send(s.channel, s.admin, { body: `Ahoj ${mentionToken(s.client.id)}` });
    expect((await eventsOf(s.client.id)).map((e) => e.kind).sort()).toEqual([
      'chat.mention',
      'chat.message',
    ]);
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(2);
    expect(sentTo(s.endpoint)).toHaveLength(1);
    expect((await eventsOf(s.client.id)).every((e) => e.deliveredAt !== null)).toBe(true);
  });

  // Both orders: the weaker event's batch runs first (it must yield to the later mention), or the
  // mention's does (the message must then see it delivered). Ids fix the order within created_at.
  for (const first of ['chat.message', 'chat.mention'] as const) {
    it(`one push per message even when its events land in different batches (${first} first)`, async () => {
      const s = await setup();
      await send(s.channel, s.admin, { body: `Ahoj ${mentionToken(s.client.id)}` });
      const prefix = randomUUID();
      for (const kind of ['chat.message', 'chat.mention'] as const) {
        await deps.db
          .update(notificationEvents)
          .set({ id: `${prefix}-${kind === first ? 1 : 2}` })
          .where(
            and(eq(notificationEvents.userId, s.client.id), eq(notificationEvents.kind, kind)),
          );
      }
      expect(await deliverPending(deps, { userIds: [s.client.id], limit: 1 })).toBe(2);
      expect(sentTo(s.endpoint)).toHaveLength(1);
    });
  }

  it("a message's events share one created_at (the sibling lookup relies on it)", async () => {
    const s = await setup();
    const root = await send(s.channel, s.client, { body: `Hi ${mentionToken(s.admin.id)}` });
    // A reply that mentions the root's author: chat.mention and chat.thread_reply for one user.
    const reply = await send(s.channel, s.admin, {
      parentId: root.id,
      body: `Re ${mentionToken(s.client.id)}`,
    });
    // Siblings are one user's events of one message: the admin has message + mention for the
    // root, the client mention + thread reply for the reply. Each pair must share created_at.
    for (const [userId, m] of [
      [s.admin.id, root],
      [s.client.id, reply],
    ] as const) {
      const rows = (await eventsOf(userId)).filter(
        (e) => (e.payload as { messageId: string }).messageId === m.id,
      );
      expect(rows).toHaveLength(2);
      const instants = await deps.db
        .selectDistinct({ at: sql<string>`${notificationEvents.createdAt}::text` })
        .from(notificationEvents)
        .where(
          inArray(
            notificationEvents.id,
            rows.map((r) => r.id),
          ),
        );
      expect(instants).toHaveLength(1);
    }
    const kinds = (await eventsOf(s.client.id))
      .filter((e) => (e.payload as { messageId: string }).messageId === reply.id)
      .map((e) => e.kind)
      .sort();
    expect(kinds).toEqual(['chat.mention', 'chat.thread_reply']);
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(2);
    expect(sentTo(s.endpoint)).toHaveLength(1);
  });

  it('a deliver job that runs before the queue is ready still sends its push', async () => {
    const s = await setup();
    await send(s.channel, s.admin);
    // As in createDeps: pg-boss may run a job before startJobs has returned the queue.
    const forward = createDeferredQueue();
    const handlers = notificationsJobHandlers({ ...deps, jobs: forward.queue });
    const running = handlers[DELIVER_JOB]!({ userIds: [s.client.id] });
    await vi.waitFor(async () =>
      expect((await eventsOf(s.client.id))[0]!.deliveredAt).toBeInstanceOf(Date),
    );
    expect(sentTo(s.endpoint)).toHaveLength(0);
    forward.resolve(createInlineJobs(handlers));
    await running;
    expect(sentTo(s.endpoint)).toHaveLength(1);
  });

  it('a message read before delivery is skipped', async () => {
    const s = await setup();
    await send(s.channel, s.admin);
    await markRead(deps.db, s.client.id, s.channel.id, new Date(Date.now() + 1000));
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(1);
    expect(sentTo(s.endpoint)).toHaveLength(0);
    expect((await eventsOf(s.client.id))[0]!.deliveredAt).toBeInstanceOf(Date);
  });

  it('a client removed after the event gets no push', async () => {
    const s = await setup();
    await send(s.channel, s.admin);
    await deps.db
      .delete(groupMembers)
      .where(and(eq(groupMembers.userId, s.client.id), eq(groupMembers.groupId, s.group.id)));
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(1);
    expect(sentTo(s.endpoint)).toHaveLength(0);
  });

  it('a deleted message is not pushed', async () => {
    const s = await setup();
    const m = await send(s.channel, s.admin);
    await deleteMessage(quiet, { message: (await getMessage(deps.db, m.id))!, channel: s.channel });
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(1);
    expect(sentTo(s.endpoint)).toHaveLength(0);
  });

  it('mode off sends nothing, even for a mention', async () => {
    const s = await setup();
    await setGroupMode(deps.db, s.client.id, s.group.id, 'off');
    await send(s.channel, s.admin, { body: `Ahoj ${mentionToken(s.client.id)}` });
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(2);
    expect(sentTo(s.endpoint)).toHaveLength(0);
  });

  it('task.moved arrives in mentions mode', async () => {
    const s = await setup();
    await setGroupMode(deps.db, s.client.id, s.group.id, 'mentions');
    await send(s.channel, s.admin); // a plain message: filtered out in this mode
    const task = await createTask(
      quiet,
      s.client,
      s.group.id,
      TaskCreateSchema.parse({ title: 'Report' }),
    );
    const review = (await listBuckets(deps.db, s.group.id)).find(
      (b) => b.kind === 'egrant_review',
    )!;
    await moveTask(quiet, s.admin, task.id, { bucketId: review.id, afterTaskId: null });
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(2);
    const sent = sentTo(s.endpoint);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload).toMatchObject({
      title: `Report · ${s.group.name}`,
      url: `/groups/${s.group.id}/tasks/${task.id}`,
    });
  });

  it('push switched off sends nothing but still marks delivered', async () => {
    const s = await setup();
    await updateNotificationPrefs(deps.db, s.client.id, { pushEnabled: false });
    await send(s.channel, s.admin);
    // Nothing could be sent, so the event is recorded as delivered and the worker skips it.
    expect((await eventsOf(s.client.id))[0]!.deliveredAt).toBeInstanceOf(Date);
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(0);
    expect(sentTo(s.endpoint)).toHaveLength(0);
  });

  it('push switched off after the event still marks it delivered and sends nothing', async () => {
    const s = await setup();
    await send(s.channel, s.admin);
    await updateNotificationPrefs(deps.db, s.client.id, { pushEnabled: false });
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(1);
    expect(sentTo(s.endpoint)).toHaveLength(0);
    expect((await eventsOf(s.client.id))[0]!.deliveredAt).toBeInstanceOf(Date);
  });

  it('email-eligible events get email_due_at = delivered_at + delay; others stay null', async () => {
    const s = await setup();
    const other = await newClient(s.group.id, 'Boris');
    await updateNotificationPrefs(deps.db, s.client.id, { emailEnabled: true });
    await send(s.channel, s.admin);
    await deliverPending(deps, { userIds: [s.client.id, other.id] });
    const [mine] = await eventsOf(s.client.id);
    expect(mine!.emailDueAt!.getTime() - mine!.deliveredAt!.getTime()).toBe(
      deps.config.emailBatchDelayMs,
    );
    const [theirs] = await eventsOf(other.id);
    expect(theirs!.deliveredAt).toBeInstanceOf(Date);
    expect(theirs!.emailDueAt).toBeNull();
  });

  it('a task chat payload links to the task chat', async () => {
    const s = await setup();
    const task = await createTask(
      quiet,
      s.admin,
      s.group.id,
      TaskCreateSchema.parse({ title: 'Report' }),
    );
    const m = await send(s.channel, s.admin);
    // Task chats (Phase 9) record `chat.message` with `taskId` in the payload.
    await deps.db
      .update(notificationEvents)
      .set({
        payload: sql`${notificationEvents.payload} || ${JSON.stringify({ taskId: task.id })}::jsonb`,
      })
      .where(eq(notificationEvents.userId, s.client.id));
    await deliverPending(deps, { userIds: [s.client.id] });
    const [sent] = sentTo(s.endpoint);
    expect(sent!.payload).toMatchObject({
      title: `Report · ${s.group.name}`,
      url: `/groups/${s.group.id}/tasks/${task.id}?tab=chat&message=${m.id}`,
    });
  });

  it('two workers never deliver the same event twice', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i++) await send(s.channel, s.admin, { body: `Message ${i}` });
    const counts = await Promise.all([
      deliverPending(deps, { userIds: [s.client.id], limit: 5 }),
      deliverPending(deps, { userIds: [s.client.id], limit: 5 }),
    ]);
    expect(counts[0] + counts[1]).toBe(30);
    const sent = sentTo(s.endpoint);
    expect(sent).toHaveLength(30);
    expect(new Set(sent.map((x) => x.payload.body)).size).toBe(30);
    expect(await deliverPending(deps, { userIds: [s.client.id] })).toBe(0);
  }, 30_000); // 30 sends, each recording an event for every admin in the shared test database

  it('410 deletes the subscription', async () => {
    const s = await setup();
    push.failNext(s.endpoint, 'gone');
    await send(s.channel, s.admin);
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(await getSubscriptionByEndpoint(s.endpoint)).toBeNull();
  });
});

describe('sendPush', () => {
  const payload = { title: 't', body: 'b', url: '/x', tag: 'g' };

  it('a 500 throws so pg-boss retries, and the subscription stays', async () => {
    const s = await setup();
    const sub = (await getSubscriptionByEndpoint(s.endpoint))!;
    push.failNext(s.endpoint, 500);
    await expect(sendPush(deps, { subscriptionId: sub.id, payload })).rejects.toThrow(/500/);
    expect(await getSubscription(deps.db, sub.id)).not.toBeNull();
    expect((await getSubscription(deps.db, sub.id))!.lastSuccessAt).toBeNull();
  });

  it('a missing subscription is a no-op; a sent push marks success', async () => {
    const s = await setup();
    await sendPush(deps, { subscriptionId: randomUUID(), payload });
    const sub = (await getSubscriptionByEndpoint(s.endpoint))!;
    await sendPush(deps, { subscriptionId: sub.id, payload });
    expect(sentTo(s.endpoint)).toEqual([{ endpoint: s.endpoint, payload }]);
    expect((await getSubscription(deps.db, sub.id))!.lastSuccessAt).toBeInstanceOf(Date);
  });
});

async function getSubscriptionByEndpoint(endpoint: string) {
  const [row] = await deps.db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.endpoint, [endpoint]));
  return row ?? null;
}
