import type { Config } from '../config/config.js';
import { createElasticSender } from './elastic-sender.js';
import type { EmailMessage, EmailSender } from './email.js';
import type { JobHandlers, JobOptions, JobQueue, QueueSettings } from '../jobs/jobs.js';
import { createSmtpSender } from './smtp-sender.js';

export { EmailSendError } from './email.js';
export type { EmailMessage, EmailSender } from './email.js';
export {
  BulkSendError,
  createBulkSender,
  createFakeBulkSender,
  type BulkEmailSender,
  type BulkMessage,
  type BulkSendResult,
  type FakeBulkSender,
} from './bulk.js';

export function createEmailSender(
  config: Config['email'],
  fetchImpl: typeof fetch = fetch,
): EmailSender {
  return config.driver === 'smtp'
    ? createSmtpSender(config)
    : createElasticSender(config, fetchImpl);
}

export const EMAIL_JOB = 'email.send';

/** Job handlers that send queued email; passed to `startJobs`. */
export function emailJobHandlers(email: EmailSender): JobHandlers {
  return { [EMAIL_JOB]: async (data) => email.send(data as EmailMessage) };
}

/** Two emails at once: the digests of several users do not wait for each other. */
export const emailQueues: Record<string, QueueSettings> = {
  [EMAIL_JOB]: { localConcurrency: 2 },
};

/**
 * Queues an email so a slow or failing provider never blocks the request; pg-boss retries.
 * `options` are pg-boss send options, e.g. a short expiry for emails that go stale.
 */
export function sendEmailLater(
  jobs: JobQueue,
  msg: EmailMessage,
  options?: JobOptions,
): Promise<void> {
  return jobs.send(EMAIL_JOB, msg, options);
}
