import { afterAll, describe, expect, it } from 'vitest';
import type { PgBoss } from 'pg-boss';
import { startJobs } from './jobs.js';
import { testDatabaseUrl } from '../../../test/test-config.js';

describe('jobs', () => {
  let boss: PgBoss | undefined;
  afterAll(async () => {
    await boss?.stop({ graceful: false, timeout: 2000 });
  });

  it('delivers a sent job to a worker within 5 seconds', async () => {
    boss = await startJobs(testDatabaseUrl);
    await boss.createQueue('test-job');

    const received = new Promise<unknown>((resolve) => {
      void boss!.work('test-job', async (jobs) => {
        resolve(jobs[0]?.data);
      });
    });
    await boss.send('test-job', { a: 1 });

    const data = await Promise.race([
      received,
      new Promise((_, reject) => setTimeout(() => reject(new Error('job not received')), 5000)),
    ]);
    expect(data).toEqual({ a: 1 });
  }, 10_000);
});
