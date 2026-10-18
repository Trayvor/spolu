import type { FastifyInstance } from 'fastify';
import { ErrorCodes } from '@spolu/shared';
import { internalCallUser } from '../auth/internal-calls.js';
import { isAllowedRoutePattern } from './allowlist.js';

/**
 * The exact-match half of the MCP allowlist (ADR 0033): on every in-process call made as a user
 * (`runAsUser`, which only MCP tools make), the route Fastify resolved, by method and registered
 * pattern, must be an allowlist entry. `createApiCaller` checks the concrete path against the
 * entries' regexes first; this catches a static sibling route the regex also matches
 * (`GET /api/tasks/search` next to `GET /api/tasks/:id`) and an unmatched path. Register it on
 * the root app before the routes.
 */
export function registerMcpRouteGuard(app: FastifyInstance): void {
  app.addHook('onRequest', async (request, reply) => {
    const user = internalCallUser(request.headers);
    if (!user) return;
    if (!isAllowedRoutePattern(request.method, request.routeOptions.url, user)) {
      return reply
        .code(403)
        .send({ error: ErrorCodes.forbidden, detail: 'route not allowed for MCP' });
    }
  });
}
