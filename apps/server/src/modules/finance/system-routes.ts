import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';

/**
 * The system-wide page and its rankings: part D owns this file. Registered by `routes.ts` inside `requireFinance`; part A1 leaves it empty.
 * Routes (spec §7):
 *   GET /api/finance/overview?clients=&from=&to=
 *   GET /api/finance/work-log?clients=&from=&to=&before=
 *   GET /api/finance/contracts?clients=&sort=&q=&after=
 *   GET /api/finance/rankings/paid?year=&month=&currency=&clients=&after=
 *   GET /api/finance/rankings/hours?from=&to=&admin=&sort=&clients=&after=
 */
export const financeSystemRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async () => {};
