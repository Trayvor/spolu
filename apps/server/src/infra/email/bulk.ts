import type { Config } from '../config/config.js';
import type { EmailMessage } from './email.js';
import { createElasticBulkSender } from './bulk-elastic.js';
import { createSmtpBulkSender } from './bulk-smtp.js';

/**
 * One bulk email to one person (Phase 23, spec §5). `idempotencyKey` and `postback` are
 * `<campaignId>:<userId>`; the two URLs carry the person's signed unsubscribe token.
 */
export type BulkMessage = EmailMessage & {
  /** Exactly one recipient. */
  to: [string];
  idempotencyKey: string;
  postback: string;
  /** Spolu's unsubscribe page for this person. */
  unsubscribeUrl: string;
  /** Spolu's RFC 8058 one-click endpoint for this person. */
  oneClickUrl: string;
};

export type BulkSendResult = { transactionId: string | null; messageId: string | null };

export interface BulkEmailSender {
  /** How the footer link must look for this driver (Elastic's `{unsubscribe:…}` or the URL). */
  unsubscribeHref(unsubscribeUrl: string): string;
  send(msg: BulkMessage): Promise<BulkSendResult>;
}

/**
 * A failed bulk send. `retryable`: a network error, a timeout, `409` (the same key is still
 * running), `429` or `5xx`; anything else (e.g. `400`, `422`) is final. `status` is the HTTP
 * status, null without an answer. The message never contains the API key.
 */
export class BulkSendError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'BulkSendError';
  }
}

/** Whether an HTTP status of a failed send is worth another attempt. */
export const isRetryableStatus = (status: number): boolean =>
  status === 409 || status === 429 || status >= 500;

/**
 * The bulk sender of `BULK_EMAIL_DRIVER`: `elastic` posts to Elastic's `/v4/emails`, `smtp`
 * (dev, tests, e2e) reuses the transactional SMTP settings with the bulk From.
 */
export function createBulkSender(
  config: Config['bulkEmail'],
  smtp: Config['email'],
  fetchImpl: typeof fetch = fetch,
): BulkEmailSender {
  if (config.driver === 'elastic') return createElasticBulkSender(config, fetchImpl);
  if (smtp.driver !== 'smtp') {
    throw new Error('BULK_EMAIL_DRIVER=smtp needs EMAIL_DRIVER=smtp');
  }
  return createSmtpBulkSender({ ...smtp, from: config.from });
}

export type FakeBulkSender = BulkEmailSender & {
  /** Messages delivered, once per idempotency key. */
  sent: BulkMessage[];
  /** Fail the next call (queued in order) with an HTTP status or a network error. */
  failNext(status: number | 'network'): void;
  /** Every call per idempotency key, failed ones included. */
  callsByKey: Map<string, number>;
};

/**
 * A bulk sender for unit tests. Like Elastic, a repeated idempotency key replays the first
 * answer and delivers nothing new, so a retried job shows up as two calls but one email.
 */
export function createFakeBulkSender(): FakeBulkSender {
  const failures: (number | 'network')[] = [];
  const answers = new Map<string, BulkSendResult>();
  const fake: FakeBulkSender = {
    sent: [],
    callsByKey: new Map(),
    failNext(status) {
      failures.push(status);
    },
    unsubscribeHref: (url) => url,
    async send(msg) {
      const key = msg.idempotencyKey;
      fake.callsByKey.set(key, (fake.callsByKey.get(key) ?? 0) + 1);
      const failure = failures.shift();
      if (failure === 'network') throw new BulkSendError('fake network error', true, null);
      if (failure !== undefined) {
        throw new BulkSendError(`fake ${failure}`, isRetryableStatus(failure), failure);
      }
      const replay = answers.get(key);
      if (replay) return replay;
      const n = answers.size + 1;
      const answer = { transactionId: `fake-tx-${n}`, messageId: `fake-msg-${n}` };
      answers.set(key, answer);
      fake.sent.push(msg);
      return answer;
    },
  };
  return fake;
}
