import type { JobHandlers, JobQueue } from './jobs.js';

/** Tests only: `send` runs the handler right away, so a test can assert on the result. */
export function createInlineJobs(handlers: JobHandlers): JobQueue {
  return {
    // Options (expiry, retention) mean nothing when the handler runs at once. A delayed job
    // (`startAfter`) is skipped: running it now would be wrong, tests call its function instead.
    async send(name, data, options) {
      if (options?.startAfter) return;
      const handler = handlers[name];
      if (!handler) throw new Error(`No handler for job "${name}"`);
      await handler(data);
    },
  };
}
