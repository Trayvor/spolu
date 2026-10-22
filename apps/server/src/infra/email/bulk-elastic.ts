import {
  BulkSendError,
  isRetryableStatus,
  type BulkEmailSender,
  type BulkMessage,
} from './bulk.js';

/** Elastic's "send bulk merge email" endpoint: the marketing one, each recipient their copy. */
const ENDPOINT = 'https://api.elasticemail.com/v4/emails';
/** Provider text kept in an error (the recipient row stores at most 500 characters). */
const MAX_ERROR_TEXT = 300;

/**
 * Bulk email through Elastic Email's v4 API, one call per person (ADR 0016). The stable
 * `Idempotency-Key` makes a retried call return the stored answer instead of sending again.
 * Opens and clicks are tracked only when the webhook secret is set (ADR 0070): without the
 * webhook nobody would receive the events. In `elastic` unsubscribe mode the footer link passes
 * through Elastic's `{unsubscribe:…}` wrapper and Elastic sets `List-Unsubscribe`; in `spolu`
 * mode the link goes straight to Spolu and the headers are Spolu's own.
 */
export function createElasticBulkSender(
  opts: {
    apiKey: string;
    from: string;
    unsubscribe: 'elastic' | 'spolu';
    webhookSecret: string | null;
  },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): BulkEmailSender {
  const clean = (text: string): string =>
    text.split(opts.apiKey).join('[key]').slice(0, MAX_ERROR_TEXT);

  const tracking = opts.webhookSecret !== null;

  return {
    unsubscribeHref: (url) => (opts.unsubscribe === 'elastic' ? `{unsubscribe:${url}}` : url),

    async send(msg: BulkMessage) {
      const body = {
        Recipients: [{ Email: msg.to[0] }],
        Content: {
          From: opts.from,
          Subject: msg.subject,
          Body: [
            { ContentType: 'HTML', Content: msg.html },
            { ContentType: 'PlainText', Content: msg.text },
          ],
          ...(opts.unsubscribe === 'spolu'
            ? {
                Headers: {
                  'List-Unsubscribe': `<${msg.oneClickUrl}>`,
                  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
                },
              }
            : {}),
          Postback: msg.postback,
        },
        Options: { TrackOpens: tracking, TrackClicks: tracking },
      };
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-ElasticEmail-ApiKey': opts.apiKey,
            'Idempotency-Key': msg.idempotencyKey,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Network failure or timeout: Elastic may or may not have the email; the same key on
        // the retry makes that safe.
        const reason = error instanceof Error ? error.message : String(error);
        throw new BulkSendError(`Elastic Email request failed: ${clean(reason)}`, true, null);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new BulkSendError(
          `Elastic Email responded ${res.status}: ${clean(text)}`,
          isRetryableStatus(res.status),
          res.status,
        );
      }
      const answer = (await res.json().catch(() => null)) as {
        TransactionID?: unknown;
        MessageID?: unknown;
      } | null;
      return {
        transactionId: typeof answer?.TransactionID === 'string' ? answer.TransactionID : null,
        messageId: typeof answer?.MessageID === 'string' ? answer.MessageID : null,
      };
    },
  };
}
