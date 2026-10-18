import { createHmac, timingSafeEqual, type Hmac } from 'node:crypto';
import { Transform } from 'node:stream';
import type {
  FastifyReply,
  FastifyRequest,
  preParsingAsyncHookHandler,
  preValidationAsyncHookHandler,
} from 'fastify';
import { ErrorCodes } from '@spolu/shared';
import type { Config, EgrantWebhook } from '../config/config.js';

/**
 * Optional HMAC signing of the eGrant webhooks, on top of the Bearer key (ADR 0042,
 * `docs/integrations/egrant.md`, "Request signing"). When a webhook's
 * EGRANT_<NAME>_SIGNING_SECRET is set, every call must carry
 *
 *   X-Spolu-Timestamp: <unix seconds>
 *   X-Spolu-Signature: sha256=<hex of HMAC-SHA256(secret, "<timestamp>.<raw body>")>
 *
 * with the timestamp within ±300 s of Help's clock and a signature not seen before; anything
 * else is 401. Unset: the webhook behaves as it did without signing.
 */

/** Allowed difference between eGrant's and Help's clocks, in seconds. */
export const EGRANT_SIGNATURE_SKEW_SECONDS = 300;
/** Upper bound of remembered signatures (a full window at ~33 calls a second). */
const REPLAY_CACHE_MAX = 10_000;

const TIMESTAMP = /^\d{1,12}$/;
const SIGNATURE = /^sha256=([0-9a-f]{64})$/i;

type SigningConfig = Pick<Config, 'egrantSigningSecrets'>;

/** The signature eGrant sends: what Help computes to compare (and what the docs and tests use). */
export function signEgrantRequest(
  secret: string,
  timestamp: number | string,
  rawBody: string | Buffer,
): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`;
}

/**
 * Signatures already taken, each until its timestamp leaves the window (after that the timestamp
 * alone refuses it). In memory: Help runs as one instance, and a restart forgets at most five
 * minutes of signatures of idempotent calls (ADR 0042).
 */
export function createReplayCache(max = REPLAY_CACHE_MAX) {
  const expiries = new Map<string, number>();
  return {
    /** true when `key` was not seen (and remembers it until `expiresAt`); false for a replay. */
    firstTime(key: string, expiresAt: number, now: number): boolean {
      const known = expiries.get(key);
      if (known !== undefined && known >= now) return false;
      expiries.delete(key);
      // Map order is insertion order: drop expired entries from the front, then the oldest.
      for (const [k, at] of expiries) {
        if (at >= now && expiries.size < max) break;
        expiries.delete(k);
      }
      expiries.set(key, expiresAt);
      return true;
    },
    size: () => expiries.size,
  };
}

/** What the preParsing hook leaves on the request for the check after parsing. */
interface Pending {
  timestamp: number;
  given: Buffer;
  hmac: Hmac;
  /** The digest, once the body stream ended. */
  digest: Buffer | null;
  verified: boolean;
}
const pendingOf = new WeakMap<FastifyRequest, Pending>();

const unauthorized = (reply: FastifyReply) =>
  reply.code(401).send({ error: ErrorCodes.unauthorized });

/**
 * Route hooks that verify the signature of one eGrant webhook. Spread them into the route's
 * options next to its Bearer gate (`onRequest`) and `bodyLimit`:
 *
 *   { onRequest: gate, bodyLimit, ...egrantSignature(config, 'groups') }
 *
 * The Bearer gate stays first. The headers and the clock are checked before the body is read;
 * the body is hashed while Fastify reads it (no second copy, the route's `bodyLimit` still
 * applies), and the signature is compared after parsing, before the handler runs. No secret:
 * no hooks, the route is unchanged.
 */
export function egrantSignature(
  config: SigningConfig,
  webhook: EgrantWebhook,
  options: { now?: () => number } = {},
): { preParsing?: preParsingAsyncHookHandler; preValidation?: preValidationAsyncHookHandler } {
  const secret = config.egrantSigningSecrets[webhook];
  if (!secret) return {};
  const now = options.now ?? (() => Math.floor(Date.now() / 1000));
  const seen = createReplayCache();

  const preParsing: preParsingAsyncHookHandler = async (request, reply, payload) => {
    const ts = request.headers['x-spolu-timestamp'];
    const sig = request.headers['x-spolu-signature'];
    const match = typeof sig === 'string' ? SIGNATURE.exec(sig) : null;
    if (typeof ts !== 'string' || !TIMESTAMP.test(ts) || !match) {
      request.log.warn({ webhook }, 'egrant signature: missing or malformed');
      return unauthorized(reply);
    }
    const timestamp = Number(ts);
    if (Math.abs(now() - timestamp) > EGRANT_SIGNATURE_SKEW_SECONDS) {
      request.log.warn({ webhook, skew: now() - timestamp }, 'egrant signature: stale timestamp');
      return unauthorized(reply);
    }
    const pending: Pending = {
      timestamp,
      given: Buffer.from(match[1]!, 'hex'),
      hmac: createHmac('sha256', secret).update(`${ts}.`),
      digest: null,
      verified: false,
    };
    pendingOf.set(request, pending);
    // Hash the bytes as they pass on to the parser; the parser enforces the body limit.
    let received = 0;
    const tee = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length;
        (tee as Transform & { receivedEncodedLength: number }).receivedEncodedLength = received;
        pending.hmac.update(chunk);
        done(null, chunk);
      },
      flush(done) {
        pending.digest = pending.hmac.digest();
        done();
      },
    });
    payload.on('error', (error) => tee.destroy(error));
    return payload.pipe(tee);
  };

  const preValidation: preValidationAsyncHookHandler = async (request, reply) => {
    const pending = pendingOf.get(request);
    if (!pending) return unauthorized(reply);
    // A request without a body never streamed: its signature covers "<timestamp>." alone.
    const digest = pending.digest ?? pending.hmac.digest();
    if (pending.given.length !== digest.length || !timingSafeEqual(pending.given, digest)) {
      request.log.warn({ webhook }, 'egrant signature: mismatch');
      return unauthorized(reply);
    }
    const key = `${webhook}:${digest.toString('hex')}`;
    const t = now();
    if (!seen.firstTime(key, pending.timestamp + EGRANT_SIGNATURE_SKEW_SECONDS, t)) {
      request.log.warn({ webhook }, 'egrant signature: replay');
      return unauthorized(reply);
    }
    pending.verified = true;
  };

  return { preParsing, preValidation };
}

/**
 * The outcome of `egrantSignature` for a request, for a handler or a test that wants to know:
 * `off` (no secret for this webhook), `ok` (verified) or `bad` (the hooks did not verify it,
 * for example because the route does not spread them).
 */
export function verifyEgrantSignature(
  config: SigningConfig,
  webhook: EgrantWebhook,
  request: FastifyRequest,
): 'off' | 'ok' | 'bad' {
  if (!config.egrantSigningSecrets[webhook]) return 'off';
  return pendingOf.get(request)?.verified ? 'ok' : 'bad';
}
