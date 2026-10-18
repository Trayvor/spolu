import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { inArray } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { EMAIL_JOB } from '../../infra/email/index.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { createFakePushSender } from '../../infra/push/index.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { setNotificationChannel } from '../users/service.js';
import { deliverPending } from './deliver.js';
import { sendDueDigests } from './digest.js';
import { saveSubscription } from './push-subscriptions.js';
import { notificationEvents } from './schema.js';
import { PUSH_JOB } from './service.js';

// S7 (Phase 27): the delivery and digest jobs load a batch's context in a fixed number of
// queries, however many groups and devices the batch spans.
const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
afterAll(async () => {
  await counting.close();
  await close();
});

/**
 * A statement shape the connection has not seen yet costs an extra round trip (postgres.js
 * describes it first), so each size runs twice and the second count is compared.
 */
const warm = async <T>(run: () => Promise<T>): Promise<T> => (await run(), run());

/** A queue that records what it is asked to send, one call per `send` and `sendMany`. */
function recordingQueue() {
  const calls: { name: string; items: object[] }[] = [];
  const queue: JobQueue = {
    async send(name: string, data: object) {
      calls.push({ name, items: [data] });
    },
    async sendMany(name: string, items: object[]) {
      calls.push({ name, items });
    },
  };
  return { queue, calls };
}

/** A client in `groups` client groups, each with a pending group chat event for them. */
async function clientInGroups(groups: number, opts: { devices?: number; email?: boolean } = {}) {
  const id = randomUUID();
  await db.insert(user).values({
    id,
    email: `${randomUUID()}@example.com`,
    name: 'Anna',
    role: 'client',
    emailVerified: true,
  });
  for (let d = 0; d < (opts.devices ?? 0); d++) {
    await saveSubscription(db, id, {
      endpoint: `https://push.example.test/${randomUUID()}`,
      p256dh: 'pk',
      auth: 'au',
      userAgent: null,
    });
  }
  if (opts.email) await setNotificationChannel(db, id, 'chat', 'email');
  const eventIds: string[] = [];
  for (let g = 0; g < groups; g++) {
    const group = await createGroup(db, {
      name: `Firma ${g}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    await addMember(db, group.id, id);
    const eventId = randomUUID();
    eventIds.push(eventId);
    await db.insert(notificationEvents).values({
      id: eventId,
      userId: id,
      groupId: group.id,
      kind: 'chat.message',
      payload: { channelId: randomUUID(), groupId: group.id, authorName: 'Jana', excerpt: 'Ahoj' },
    });
  }
  return { id, eventIds };
}

describe('deliverPending batching', () => {
  const deliverCounting = async (groups: number) => {
    const c = await clientInGroups(groups, { devices: 3 });
    const { queue, calls } = recordingQueue();
    const deps = {
      db: counting.db,
      config: testConfig(),
      push: createFakePushSender(),
      jobs: queue,
    };
    counting.reset();
    expect(await deliverPending(deps, { eventIds: c.eventIds })).toBe(groups);
    return { queries: counting.count(), calls };
  };

  it('a batch over many groups takes as many queries as one over two', async () => {
    const small = await warm(() => deliverCounting(2));
    const large = await warm(() => deliverCounting(12));
    expect(large.queries).toBe(small.queries);
  });

  it("queues a batch's pushes in one call", async () => {
    const { calls } = await deliverCounting(12);
    const pushCalls = calls.filter((c) => c.name === PUSH_JOB);
    expect(pushCalls).toHaveLength(1);
    expect(pushCalls[0]!.items).toHaveLength(12 * 3);
  });
});

describe('sendDueDigests batching', () => {
  const digestCounting = async (groups: number) => {
    const c = await clientInGroups(groups, { email: true });
    const now = new Date(Date.now() + 60 * 60_000);
    await db
      .update(notificationEvents)
      .set({ deliveredAt: new Date(), emailDueAt: new Date() })
      .where(inArray(notificationEvents.id, c.eventIds));
    const { queue } = recordingQueue();
    const deps = { db: counting.db, config: testConfig(), push: null, jobs: queue };
    counting.reset();
    expect(await sendDueDigests(deps, { now, userIds: [c.id] })).toBe(groups);
    return counting.count();
  };

  it('digests of many groups take as many queries as digests of two', async () => {
    const small = await warm(() => digestCounting(2));
    const large = await warm(() => digestCounting(12));
    expect(large).toBe(small);
  });

  it('queues the digests in one call and takes at most maxPairs per run (2026-10-18)', async () => {
    const c = await clientInGroups(5, { email: true });
    const now = new Date(Date.now() + 60 * 60_000);
    await db
      .update(notificationEvents)
      .set({ deliveredAt: new Date(), emailDueAt: new Date() })
      .where(inArray(notificationEvents.id, c.eventIds));
    const { queue, calls } = recordingQueue();
    const deps = { db, config: testConfig(), push: null, jobs: queue };
    expect(await sendDueDigests(deps, { now, userIds: [c.id], maxPairs: 3 })).toBe(3);
    expect(calls).toEqual([{ name: EMAIL_JOB, items: expect.any(Array) }]);
    expect(calls[0]!.items).toHaveLength(3);
    expect(await sendDueDigests(deps, { now, userIds: [c.id], maxPairs: 3 })).toBe(2);
    expect(await sendDueDigests(deps, { now, userIds: [c.id], maxPairs: 3 })).toBe(0);
  });
});
