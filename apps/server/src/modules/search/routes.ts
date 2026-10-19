import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, MessageSearchQuerySchema, SearchQuerySchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { search, searchMessagePage } from './service.js';

/**
 * Typing in the palette asks once per pause (debounced); 120 a minute is a fast typist. Both
 * routes share it: the palette sends `/search` and `/search/messages` per pause (60 pauses).
 */
export const SEARCH_RATE = { windowMs: 60_000, max: 120 };

/**
 * Global search (2026-10-18): `GET /api/search?q=&types=&limit=`, and the pages of message hits
 * (2026-10-19) `GET /api/search/messages?q=&cursor=&limit=&groupId=`, for every signed-in user.
 * Each person finds only what they read: the modules' policies decide (see `service.ts`). The
 * request log drops their query string (`infra/http/log-redact.ts`).
 */
export const searchRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const anyUser = requireUser(app.auth);
  const allow = createRateLimiter(SEARCH_RATE);

  app.get('/search', { preHandler: anyUser }, async (request, reply) => {
    if (!allow(request.user!.id)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
    const query = SearchQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    return search(deps.db, request.user!, query.data);
  });

  app.get('/search/messages', { preHandler: anyUser }, async (request, reply) => {
    if (!allow(request.user!.id)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
    const query = MessageSearchQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    const page = await searchMessagePage(deps.db, request.user!, query.data);
    if (page === 'invalid_cursor') {
      return reply.code(400).send({ error: ErrorCodes.validationFailed });
    }
    return page;
  });
};
