import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, JoinBodySchema, type JoinInfo } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { joinGroupRoom } from '../../infra/realtime/rooms.js';
import { requireUser } from '../auth/session.js';
import { isAdmin } from '../users/policy.js';
import { addMembership } from './memberships.js';
import { getGroupByInviteToken, joinWithEmail } from './service.js';

type TokenParams = { Params: { token: string } };

/**
 * Invite-link routes (the logo is in logo.ts). Reading and joining by email need no auth: the
 * token is the credential. `accept` is for a client who is already signed in.
 */
export const joinRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps: { db } }) => {
  const allowJoin = createRateLimiter({ windowMs: 60_000, max: 10 });

  app.get<TokenParams>('/join/:token', async (request, reply) => {
    const group = await getGroupByInviteToken(db, request.params.token);
    if (!group) return reply.code(404).send({ error: ErrorCodes.notFound });
    const info: JoinInfo = {
      name: group.name,
      hasLogo: group.logoKey !== null,
      updatedAt: group.updatedAt.toISOString(),
    };
    return info;
  });

  // The answer is identical for every email so the endpoint never reveals who has an account.
  app.post<TokenParams>('/join/:token', async (request, reply) => {
    if (!allowJoin(request.ip)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    const group = await getGroupByInviteToken(db, request.params.token);
    if (!group) return reply.code(404).send({ error: ErrorCodes.notFound });
    const body = JoinBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    await joinWithEmail(db, group.id, body.data.email);
    return { ok: true };
  });

  // A signed-in client joins at once: the session already proves the email. Admins read every
  // group and have no memberships; a membership an admin removed stays removed.
  app.post<TokenParams>(
    '/join/:token/accept',
    { preHandler: requireUser(app.auth) },
    async (request, reply) => {
      if (!allowJoin(request.ip)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
      const group = await getGroupByInviteToken(db, request.params.token);
      if (!group) return reply.code(404).send({ error: ErrorCodes.notFound });
      const actor = request.user!;
      if (isAdmin(actor)) return reply.code(403).send({ error: ErrorCodes.forbidden });
      const result = await addMembership(db, actor.id, group.id, 'client');
      if (result === 'removed') return reply.code(403).send({ error: ErrorCodes.removedMember });
      joinGroupRoom(app.io, actor.id, group.id);
      return { groupId: group.id };
    },
  );
};
