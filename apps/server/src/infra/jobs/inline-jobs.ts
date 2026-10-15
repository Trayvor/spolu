import type { JobHandlers, JobQueue } from './jobs.js';

/** Tests only: `send` runs the handler right away, so a test can assert on the result. */
export function createInlineJobs(handlers: JobHandlers): JobQueue {
  return {
    async send(name, data) {
      const handler = handlers[name];
      if (!handler) throw new Error(`No handler for job "${name}"`);
      await handler(data);
    },
  };
}
