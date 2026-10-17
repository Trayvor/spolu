import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { financeAccessRoutes, requireFinance } from './access.js';
import { financeDocumentsRoutes } from './documents-routes.js';
import { financeLogRoutes } from './log-routes.js';
import { financeSystemRoutes } from './system-routes.js';
import { taskTimeRoutes } from './task-time-routes.js';

/**
 * Every finance route (Phase 32). The plugin of parts B, C and D sits behind `requireFinance`
 * (401 / 403 before any handler runs), so a client or an admin without the right never reaches
 * a finance row whatever id they send. The grant switch (superadmin) and the task-time routes
 * (every admin assignee, part A2) live outside it with their own guards. Each part edits only
 * its own file (plan, "Conflict rules").
 */
export const financeRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  await app.register(financeAccessRoutes, { deps });
  await app.register(taskTimeRoutes, { deps });
  await app.register(
    async (finance) => {
      finance.addHook('preHandler', requireFinance(app.auth));
      await finance.register(financeDocumentsRoutes, { deps });
      await finance.register(financeLogRoutes, { deps });
      await finance.register(financeSystemRoutes, { deps });
    },
    { deps },
  );
};
