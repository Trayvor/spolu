import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PgBoss } from 'pg-boss';
import { createInlineJobs } from './inline-jobs.js';
import { startJobs } from './jobs.js';
import { testDatabaseUrl } from '../../../test/test-config.js';

describe('jobs', () => {
  let stop: (() => Promise<void>) | undefined;
  afterAll(async () => {
    await stop?.();
  });

  it('startJobs runs the registered handler for a sent job', async () => {
    const name = `test-job-${randomUUID()}`;
    let resolveReceived!: (data: unknown) => void;
    const received = new Promise<unknown>((resolve) => (resolveReceived = resolve));
    const jobs = await startJobs(testDatabaseUrl, {
      [name]: async (data) => resolveReceived(data),
    });
    stop = jobs.stop;
    await jobs.queue.send(name, { a: 1 });

    const data = await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error('job not received')), 30_000)),
    ]);
    expect(data).toEqual({ a: 1 });
  }, 45_000);

  it('startJobs registers the schedule', async () => {
    const name = `test-schedule-${randomUUID()}`;
    const jobs = await startJobs(testDatabaseUrl, { [name]: async () => {} }, [
      { name, cron: '15 3 * * *' },
    ]);
    try {
      const boss = new PgBoss(testDatabaseUrl);
      await boss.start();
      try {
        const schedules = await boss.getSchedules(name);
        expect(schedules.map((s) => s.cron)).toEqual(['15 3 * * *']);
      } finally {
        await boss.stop({ graceful: false });
      }
    } finally {
      await jobs.stop();
    }
  }, 15_000);

  it('startJobs gives a queue its policy and recreates one created with another policy', async () => {
    const name = `test-policy-${randomUUID()}`;
    const boss = new PgBoss(testDatabaseUrl);
    await boss.start();
    try {
      await boss.createQueue(name); // standard, as before the queue had a policy
      const jobs = await startJobs(testDatabaseUrl, { [name]: async () => {} }, [], {
        [name]: { policy: 'stately' },
      });
      await jobs.stop();
      const queue = await boss.getQueue(name);
      expect(queue?.policy).toBe('stately');
      expect(queue?.notify).toBe(true);
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 15_000);

  // With notify on, pg-boss polls only every 30 s, and a delayed job sends no NOTIFY when due.
  it('startJobs runs a delayed job of a notify: false queue within seconds of its start', async () => {
    const name = `test-delayed-${randomUUID()}`;
    const boss = new PgBoss(testDatabaseUrl);
    await boss.start();
    try {
      await boss.createQueue(name, { notify: true }); // as created before the queue had the setting
      let ranAt = 0;
      const jobs = await startJobs(
        testDatabaseUrl,
        { [name]: async () => void (ranAt = Date.now()) },
        [],
        { [name]: { notify: false } },
      );
      try {
        expect((await boss.getQueue(name))?.notify).toBe(false);
        // Sent after the worker's first poll, so only a later poll can pick it up.
        await new Promise((r) => setTimeout(r, 500));
        await jobs.queue.send(name, {}, { startAfter: 1 });
        const deadline = Date.now() + 25_000;
        while (ranAt === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
        expect(ranAt).toBeGreaterThan(0);
      } finally {
        await jobs.stop();
      }
    } finally {
      await boss.stop({ graceful: false });
    }
  }, 45_000);

  it('startJobs runs localConcurrency jobs of a queue at once', async () => {
    const name = `test-concurrency-${randomUUID()}`;
    let running = 0;
    let peak = 0;
    let done = 0;
    // A barrier instead of a sleep: the jobs overlap whenever the sends reach the workers apart.
    let openBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => (openBarrier = resolve));
    const jobs = await startJobs(
      testDatabaseUrl,
      {
        [name]: async () => {
          running++;
          peak = Math.max(peak, running);
          if (running > 1) openBarrier();
          await Promise.race([barrier, new Promise((r) => setTimeout(r, 10_000))]);
          running--;
          done++;
        },
      },
      [],
      { [name]: { localConcurrency: 4, pollingIntervalSeconds: 0.5 } },
    );
    try {
      for (let i = 0; i < 4; i++) await jobs.queue.send(name, { i });
      const deadline = Date.now() + 25_000;
      while (done < 4 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(done).toBe(4);
      expect(peak).toBeGreaterThan(1);
    } finally {
      await jobs.stop();
    }
  }, 45_000);

  it('createInlineJobs runs the handler before send resolves', async () => {
    const seen: unknown[] = [];
    const queue = createInlineJobs({ greet: async (data) => void seen.push(data) });
    await queue.send('greet', { hi: 1 });
    expect(seen).toEqual([{ hi: 1 }]);
  });
});
