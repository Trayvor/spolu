import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createInlineJobs } from './inline-jobs.js';
import { startJobs } from './jobs.js';
import { testDatabaseUrl } from '../../../test/test-config.js';

describe('jobs', () => {
  let stop: (() => Promise<void>) | undefined;
  afterAll(async () => {
    await stop?.();
  });

  it('startJobs runs the registered handler for a sent job within 5 s', async () => {
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
      new Promise((_, reject) => setTimeout(() => reject(new Error('job not received')), 5000)),
    ]);
    expect(data).toEqual({ a: 1 });
  }, 10_000);

  it('createInlineJobs runs the handler before send resolves', async () => {
    const seen: unknown[] = [];
    const queue = createInlineJobs({ greet: async (data) => void seen.push(data) });
    await queue.send('greet', 'hi');
    expect(seen).toEqual(['hi']);
  });
});
