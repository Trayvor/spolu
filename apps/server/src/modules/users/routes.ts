import type { FastifyPluginAsync } from 'fastify';
import { AddAdminBodySchema, ErrorCodes } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { sendEmailLater } from '../../infra/email/index.js';
import { disconnectUser } from '../../infra/realtime/rooms.js';
import { adminAddedEmail } from '../auth/emails.js';
import { pickLanguage } from '../auth/language.js';
import { requireAdmin } from '../auth/session.js';
import { revokeAllSessions } from '../auth/service.js';
import { canDeactivate, canManageAdmins } from './policy.js';
import { addAdmin, deactivateUser, EmailTakenError, getUserById, listAdmins } from './service.js';

export const usersRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { config, db, jobs } },
) => {
  const preHandler = requireAdmin(app.auth);

  app.get('/admins', { preHandler }, async () => listAdmins(db));

  app.post('/admins', { preHandler }, async (request, reply) => {
    const actor = request.user!;
    if (!canManageAdmins(actor)) return reply.code(403).send({ error: ErrorCodes.forbidden });

    const body = AddAdminBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });

    let admin;
    try {
      admin = await addAdmin(db, body.data);
    } catch (error) {
      if (error instanceof EmailTakenError) {
        const code =
          error.kind === 'admin' ? ErrorCodes.emailTakenAdmin : ErrorCodes.emailTakenClient;
        return reply.code(409).send({ error: code });
      }
      throw error;
    }

    // The admin is committed; a failed email must not turn this into an error.
    try {
      const lang = pickLanguage(request.headers['accept-language']);
      const loginUrl = `${config.publicUrl}/login`;
      await sendEmailLater(
        jobs,
        adminAddedEmail(admin.email, { name: admin.name, addedBy: actor.name, loginUrl }, lang),
      );
    } catch (error) {
      request.log.error({ err: error }, 'could not queue the admin-added email');
    }
    return reply.code(201).send(admin);
  });

  app.delete<{ Params: { id: string } }>('/admins/:id', { preHandler }, async (request, reply) => {
    const { id } = request.params;
    const target = await getUserById(db, id);
    if (!target) return reply.code(404).send({ error: ErrorCodes.notFound });
    if (!canDeactivate(request.user!, target)) {
      return reply.code(403).send({ error: ErrorCodes.forbidden });
    }

    await deactivateUser(db, id);
    await revokeAllSessions(db, id);
    disconnectUser(app.io, id);
    return reply.code(204).send();
  });
};
