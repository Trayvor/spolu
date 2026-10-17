import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';

/**
 * Time on done: part A2 owns this file. Registered by `routes.ts` outside `requireFinance` (every admin assignee uses it); part A1 leaves it empty.
 * Routes (spec §7):
 *   GET /api/tasks/:id/time · PUT /api/tasks/:id/time/me { minutes }
 *   GET /api/tickets/:id/time · PUT /api/tickets/:id/time/me { minutes } | { coveredByTasks }
 * Guards: `requireAdmin`, the task's `canUseBoard` (the ticket's read rule), then
 * `canLogOwnTaskTime` (`canLogOwnTicketTime`); only about the caller unless `canSeeFinance`.
 */
export const taskTimeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async () => {};
