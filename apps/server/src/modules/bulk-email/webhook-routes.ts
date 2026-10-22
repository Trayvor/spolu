import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { verifyElasticWebhook } from '../../infra/email/elastic-webhook.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { parseElasticEvent, recordBulkEvent } from './webhook.js';

/** An event is a small flat JSON object; anything bigger is not Elastic's. */
const BODY_LIMIT = 64 * 1024;
/**
 * Calls a minute per address. Elastic posts from a few servers in bursts (every `Sent` of a
 * campaign, opens after it), so the cap is high; a refused call is retried by Elastic for 24 h.
 */
const WEBHOOK_PER_MINUTE = 1200;

const header = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

/**
 * `POST /api/bulk-email/webhook` (ADR 0070): Elastic Email's signed `PostJson` webhook. Public
 * (no session): the HMAC signature over the raw body is the credential, checked before anything
 * is parsed; a missing, wrong or stale one is 401. Registered only when ELASTIC_WEBHOOK_SECRET
 * is set, so without it the path is a 404 and nothing is tracked. Ignored events (Elastic's
 * save-time test event, test sends, unknown postbacks) are answered 200 so Elastic does not
 * retry them. Nothing of the body is logged.
 */
export const bulkEmailWebhookRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const secret =
    deps.config.bulkEmail.driver === 'elastic' ? deps.config.bulkEmail.webhookSecret : null;
  if (secret === null) return;
  const { db } = deps;
  const allow = createRateLimiter({ windowMs: 60_000, max: WEBHOOK_PER_MINUTE });

  // The signature covers the exact bytes: keep the body as text, parse it after the check.
  // Scoped to this plugin.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: BODY_LIMIT }, (_req, body, done) =>
    done(null, body),
  );

  app.post(
    '/bulk-email/webhook',
    {
      bodyLimit: BODY_LIMIT,
      onRequest: async (request, reply) => {
        if (!allow(request.ip)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
      },
    },
    async (request, reply) => {
      const rawBody = typeof request.body === 'string' ? request.body : '';
      const valid = verifyElasticWebhook({
        secret,
        timestamp: header(request.headers['x-elasticemail-timestamp']),
        signature: header(request.headers['x-elasticemail-signature']),
        method: request.method,
        // The path and query exactly as received (Fastify's `url` is the raw request target).
        target: request.url,
        rawBody,
        nowSeconds: Math.floor(Date.now() / 1000),
      });
      if (!valid) return reply.code(401).send({ error: ErrorCodes.unauthorized });

      let body: unknown;
      try {
        body = JSON.parse(rawBody);
      } catch {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }
      const event = parseElasticEvent(body, new Date());
      if (!event) {
        request.log.info('bulk email webhook: event ignored');
        return reply.code(200).send({ ok: true });
      }
      const result = await recordBulkEvent(db, event);
      if (result === 'unknown') request.log.info('bulk email webhook: unknown postback ignored');
      return reply.code(200).send({ ok: true });
    },
  );
};
