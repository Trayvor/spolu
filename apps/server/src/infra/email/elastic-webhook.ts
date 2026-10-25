import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Elastic Email's webhook signing (ADR 0070). A webhook created with `EnableSigning: true`
 * sends
 *
 *   X-ElasticEmail-Timestamp: <unix seconds>
 *   X-ElasticEmail-Signature: v1=<lowercase hex>[, v1=<…>]
 *   X-ElasticEmail-Webhook-Id: <the webhook's id>
 *
 * where the hex is HMAC-SHA256(secret, "<timestamp>\n<METHOD>\n<request target>\n<raw body>")
 * and the request target is the path and query exactly as received. Source: Elastic's
 * examples repository, docs/webhooks.md, "Verifying a signed request"
 * (https://github.com/ElasticEmail/elasticemail-examples/blob/main/docs/webhooks.md).
 */

/** Allowed difference between Elastic's and Help's clocks, in seconds (Elastic's own rule). */
export const ELASTIC_SIGNATURE_SKEW_SECONDS = 300;

const TIMESTAMP = /^\d{1,12}$/;

/** The hex signature Elastic sends for a request (what the tests and the docs use). */
export function signElasticWebhook(
  secret: string,
  timestamp: number | string,
  method: string,
  target: string,
  rawBody: string,
): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}\n${method}\n${target}\n${rawBody}`)
    .digest('hex');
}

/**
 * True when the request carries a timestamp within ±5 minutes of `nowSeconds` and at least one
 * `v1=` signature equal (constant-time) to the one computed with `secret`.
 */
export function verifyElasticWebhook(input: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  method: string;
  target: string;
  rawBody: string;
  nowSeconds: number;
}): boolean {
  const { timestamp, signature } = input;
  if (timestamp === undefined || signature === undefined || !TIMESTAMP.test(timestamp)) {
    return false;
  }
  if (Math.abs(input.nowSeconds - Number(timestamp)) > ELASTIC_SIGNATURE_SKEW_SECONDS) return false;
  const expected = Buffer.from(
    signElasticWebhook(input.secret, timestamp, input.method, input.target, input.rawBody),
  );
  let match = false;
  // Every entry is compared (no early exit), each in constant time.
  for (const part of signature.split(',')) {
    const entry = part.trim();
    if (!entry.startsWith('v1=')) continue;
    const given = Buffer.from(entry.slice(3).toLowerCase());
    if (given.length === expected.length && timingSafeEqual(given, expected)) match = true;
  }
  return match;
}
