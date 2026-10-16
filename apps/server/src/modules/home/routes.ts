import type { FastifyPluginAsync } from 'fastify';
import {
  ErrorCodes,
  GlobalBoardFilterSchema,
  HOME_LIMITS,
  type HomeReminders,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireAdmin } from '../auth/session.js';
import { getAssignedTasks } from './assigned.js';
import {
  bratislavaToday,
  getGlobalBoard,
  InvalidCursorError,
  resolveClientIds,
} from './global-board.js';
import { getMentions } from './mentions.js';
import { getReminderSource } from './reminder-source.js';
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
export const homeRoutes: FastifyPluginAsync<HomeRoutesOptions> = async (app, options) => {
  const { db } = options.deps;
  const now = options.now ?? (() => new Date());
  const adminOnly = requireAdmin(app.auth);

  app.get('/me/home/sidebar', { preHandler: adminOnly }, async (request) =>
    getSidebar(db, request.user!.id),
  );

  app.get('/me/home/tasks', { preHandler: adminOnly }, async (request) =>
    getAssignedTasks(db, request.user!.id),
  );

  app.get('/me/home/mentions', { preHandler: adminOnly }, async (request) =>
    getMentions(db, request.user!.id),
  );

  app.get(
    '/me/home/reminders',
    { preHandler: adminOnly },
    async (request): Promise<HomeReminders> => {
      const source = getReminderSource();
      if (!source) return { available: false };
      const actor = request.user!;
      const from = now();
      try {
        const [items, nextWeek] = await Promise.all([
          source.upcoming(db, actor, { from, limit: HOME_LIMITS.reminders }),
          source.countNextWeek(db, actor, from),
        ]);
        return { available: true, nextWeek, items };
      } catch (error) {
        // One card's failure never breaks the dashboard: the card shows its error line.
        request.log.error({ err: error }, 'the reminder source failed');
        return { available: true, nextWeek: 0, items: [], error: true };
      }
    },
  );

  app.get('/tasks/global', { preHandler: adminOnly }, async (request, reply) => {
    const filter = GlobalBoardFilterSchema.safeParse(request.query);
    if (!filter.success) return reply.code(400).send({ error: ErrorCodes.invalidFilter });
    const viewerId = request.user!.id;
    const { clients, ...rest } = filter.data;
    try {
      return await getGlobalBoard(db, {
        ...rest,
        clientIds: await resolveClientIds(db, viewerId, clients),
        viewerId,
        urgent: rest.urgent ?? false,
        completed: rest.completed ?? false,
        today: bratislavaToday(now()),
      });
    } catch (error) {
      if (error instanceof InvalidCursorError) {
        return reply.code(400).send({ error: ErrorCodes.invalidFilter });
      }
      throw error;
    }
  });
};
