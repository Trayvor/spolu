import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../../deps.js';
import { requireAdmin } from '../auth/session.js';
import { getAssignedTasks } from './assigned.js';
import { getSidebar } from './sidebar.js';

export type HomeRoutesOptions = {
  deps: AppDeps;
  /** The clock (tests): the global board's Bratislava "today", the reminders' "from". */
  now?: () => Date;
};

/**
 * The admin home (Phase 20): the client sidebar, the dashboard cards and the global task board.
 * Read-only, admins only (`requireAdmin`: clients get 403); admins read every group, so no
 * further permission filter applies.
 */
export const homeRoutes: FastifyPluginAsync<HomeRoutesOptions> = async (app, { deps }) => {
  const { db } = deps;
  const adminOnly = requireAdmin(app.auth);

  app.get('/me/home/sidebar', { preHandler: adminOnly }, async (request) =>
    getSidebar(db, request.user!.id),
  );

  app.get('/me/home/tasks', { preHandler: adminOnly }, async (request) =>
    getAssignedTasks(db, request.user!.id),
  );
};
