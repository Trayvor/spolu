import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import postgres from 'postgres';
import { createDb } from '../../infra/db/client.js';
import { startJobs } from '../../infra/jobs/jobs.js';
import { createFakePushSender } from '../../infra/push/index.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';
import { user } from '../users/schema.js';
import { DELIVER_JOB, notificationQueues, notificationsJobHandlers, PUSH_JOB } from './jobs.js';
import { saveSubscription } from './push-subscriptions.js';
import { PUSH_JOB_OPTIONS } from './deliver.js';
import { requestDelivery } from './service.js';

// The real pg-boss on the test database, with the queue settings production uses.
const { db, close } = createDb(testDatabaseUrl);
const sql = postgres(testDatabaseUrl, { max: 1, onnotice: () => {} });
afterAll(async () => {
  await sql.end({ timeout: 5 });
  await close();
});

describe('notification queues', () => {
  let userId: string;
  beforeAll(async () => {
    userId = randomUUID();
    await db.insert(user).values({
      id: userId,
      email: `${randomUUID()}@example.com`,
      name: 'Queue test',
      role: 'client',
      emailVerified: true,
    });
  });

  it('20 push jobs are sent in parallel', async () => {
    const fake = createFakePushSender();
    const endpoints = new Set<string>();
    let inFlight = 0;
    let maxInFlight = 0;
    // A sender as slow as the network: parallel workers overlap, a single worker never would.
    // Counting overlap instead of wall time keeps the check stable on a loaded CI runner, and the
    // 10 s wait still fails when the jobs past the second round of 8 wait for the 30 s poll.
    const push = {
      async send(...args: Parameters<typeof fake.send>) {
        const ours = endpoints.has(args[0].endpoint);
        if (ours) maxInFlight = Math.max(maxInFlight, ++inFlight);
        try {
          await new Promise((resolve) => setTimeout(resolve, 200));
          return await fake.send(...args);
        } finally {
          if (ours) inFlight--;
        }
      },
    };
    const handlers = notificationsJobHandlers({
      db,
      config: testConfig(),
      push,
      jobs: { send: async () => {} },
    });
    // Only the push worker: a deliver worker would sweep other test files' events.
    const jobs = await startJobs(testDatabaseUrl, { [PUSH_JOB]: handlers[PUSH_JOB]! }, [], {
      [PUSH_JOB]: notificationQueues[PUSH_JOB]!,
    });
    try {
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const endpoint = `https://push.example.test/${randomUUID()}`;
        endpoints.add(endpoint);
        await saveSubscription(db, userId, { endpoint, p256dh: 'pk', auth: 'au', userAgent: null });
        const [row] = await sql<{ id: string }[]>`
          select id from push_subscriptions where endpoint = ${endpoint}`;
        ids.push(row!.id);
      }
      for (const subscriptionId of ids) {
        await jobs.queue.send(
          PUSH_JOB,
          { subscriptionId, payload: { title: 't', body: 'b', url: '/', tag: 'x' } },
          PUSH_JOB_OPTIONS,
        );
      }
      // Count only ours: pushes left in the queue by an earlier run may be sent too.
      const ours = () => fake.sent.filter((p) => endpoints.has(p.endpoint));
      await vi.waitFor(() => expect(ours()).toHaveLength(20), { timeout: 10_000, interval: 50 });
      expect(maxInFlight).toBeGreaterThan(1);
    } finally {
      await jobs.stop();
    }
  }, 30_000);

  it('50 delivery requests leave at most 2 deliver jobs', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => (release = resolve));
    let runs = 0;
    // The first job stays active until the end, so the others can only queue behind it.
    const jobs = await startJobs(
      testDatabaseUrl,
      {
        [DELIVER_JOB]: async () => {
          runs++;
          await blocked;
        },
      },
      [],
      { [DELIVER_JOB]: notificationQueues[DELIVER_JOB]! },
    );
    try {
      for (let i = 0; i < 50; i++) await requestDelivery(jobs.queue, [randomUUID()]);
      const [row] = await sql<{ n: number }[]>`
        select count(*)::int as n from pgboss.job
        where name = ${DELIVER_JOB} and state in ('created', 'retry', 'active')`;
      expect(row!.n).toBeLessThanOrEqual(2);
      expect(row!.n).toBeGreaterThanOrEqual(1);
    } finally {
      release();
      await jobs.stop();
    }
    expect(runs).toBeLessThanOrEqual(2);
  }, 30_000);
});

describe('PUSH_JOB_OPTIONS', () => {
  it('expires a push job that runs over 30 s and retries it three times', () => {
    expect(PUSH_JOB_OPTIONS).toMatchObject({ expireInSeconds: 30, retryLimit: 3, retryDelay: 30 });
  });
});
