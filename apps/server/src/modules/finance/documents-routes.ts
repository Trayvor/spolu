import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';

/**
 * Documents and contracts: part B owns this file. Registered by `routes.ts` inside `requireFinance`; part A1 leaves it empty.
 * Routes (spec §7):
 *   GET  /api/groups/:id/finance/items?folder=&type=&q=&after=
 *   GET  /api/groups/:id/finance/folders
 *   POST /api/groups/:id/finance/items · GET/PATCH/DELETE /api/finance/items/:id
 *   POST /api/groups/:id/finance/folders · PATCH/DELETE /api/finance/folders/:id
 *   POST /api/groups/:id/finance/files (finance-only upload: `setFilesFinanceOnly`)
 */
export const financeDocumentsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async () => {};
