import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, SearchQuerySchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { requireUser } from '../auth/session.js';
import { search } from './service.js';

/** Typing in the palette asks once per pause (debounced); 120 a minute is a fast typist. */
export const SEARCH_RATE = { windowMs: 60_000, max: 120 };

/**
 * Global search (2026-10-18): `GET /api/search?q=&types=&limit=`, for every signed-in user. Each
 * person finds only what they read: the modules' policies decide (see `service.ts`).
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
};
