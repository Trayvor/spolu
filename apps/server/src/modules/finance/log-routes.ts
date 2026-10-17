import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';

/**
 * Overview, work log, rates and manual entries: part C owns this file. Registered by `routes.ts` inside `requireFinance`; part A1 leaves it empty.
 * Routes (spec §7):
 *   GET  /api/groups/:id/finance/overview?from=&to=
 *   GET  /api/groups/:id/finance/work-log?from=&to=&before=
 *   POST /api/groups/:id/finance/time-entries · PATCH/DELETE /api/finance/time-entries/:id
 *   GET/POST /api/finance/rates · DELETE /api/finance/rates/:id
 */
export const financeLogRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async () => {};
