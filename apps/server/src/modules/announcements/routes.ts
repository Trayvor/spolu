import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, type CurrentAnnouncement } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { requireUser } from '../auth/session.js';
import { audienceOf, currentAnnouncement, markAnnouncementSeen } from './service.js';

/**
 * "What's new" (ADR 0067): the web asks once per app load which announcement to show, and marks
 * it seen when the person closes it.
 */
export const announcementsRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const preHandler = requireUser(app.auth);

  app.get('/me/announcement', { preHandler }, async (request): Promise<CurrentAnnouncement> => {
    if (!deps.config.whatsNew) return { announcement: null };
    const audience = await audienceOf(deps.db, request.user!, deps.ai !== null);
    return { announcement: await currentAnnouncement(deps.db, audience) };
  });

  app.post<{ Params: { id: string } }>(
    '/me/announcement/:id/seen',
    { preHandler },
    async (request, reply) => {
      if (!(await markAnnouncementSeen(deps.db, request.user!.id, request.params.id))) {
        return reply.code(404).send({ error: ErrorCodes.notFound });
      }
      return reply.code(204).send();
    },
  );
};
