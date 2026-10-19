import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { CALENDAR_FEED_LIMITS, ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { toSessionUser } from '../auth/session.js';
import { getUserById } from '../users/service.js';
import { buildFeedFor } from './feed.js';
import { findFeedByToken, touchFetched } from './service.js';
import { FEED_TOKEN, feedTokenHash } from './token.js';

type TokenParams = { Params: { token: string } };

/**
 * The personal calendar feed (ADR 0051), `GET /api/public/calendar/<token>/help.ics`: no
 * session, the token is the credential. Every failure (malformed, unknown, rotated or revoked
 * token, a disabled user) is the same 404. Built at every poll for the user as they are now;
 * a matching `If-None-Match` gets 304 without a body. HEAD is Fastify's automatic HEAD route.
 */
export const calendarPublicRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps },
) => {
  const { db, config } = deps;
  const perIp = createRateLimiter({ windowMs: 60_000, max: CALENDAR_FEED_LIMITS.perIpPerMinute });
  // Google polls from many addresses: the per-token limit is the one that protects.
  const perToken = createRateLimiter({
    windowMs: 60_000,
    max: CALENDAR_FEED_LIMITS.perTokenPerMinute,
  });
  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: ErrorCodes.notFound });
  const tooMany = (reply: FastifyReply) => reply.code(429).send({ error: ErrorCodes.rateLimited });

  app.get<TokenParams>('/public/calendar/:token/help.ics', async (request, reply) => {
    if (!perIp(request.ip)) return tooMany(reply);
    const { token } = request.params;
    if (!FEED_TOKEN.test(token)) return notFound(reply);
    if (!perToken(feedTokenHash(token))) return tooMany(reply);
    const feed = await findFeedByToken(db, config.appSecret, token);
    if (!feed) return notFound(reply);
    const owner = await getUserById(db, feed.userId);
    const user = owner ? toSessionUser(owner) : null;
    if (!owner || !user) return notFound(reply);

    const now = new Date();
    const { text, etag } = await buildFeedFor(
      db,
      { ...user, language: owner.language },
      { events: feed.includeEvents, tasks: feed.includeTasks, calls: feed.includeCalls },
      config.publicUrl,
      now,
      request.log,
    );
    try {
      await touchFetched(db, feed.userId, now);
    } catch (error) {
      request.log.error({ err: error }, 'could not note the calendar feed fetch');
    }

    reply
      .header('cache-control', 'private, max-age=900')
      .header('etag', etag)
      .header('x-robots-tag', 'noindex')
      .header('referrer-policy', 'no-referrer');
    if (request.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply
      .header('content-type', 'text/calendar; charset=utf-8')
      .header('content-disposition', 'inline; filename="help.ics"')
      .send(text);
  });
};
