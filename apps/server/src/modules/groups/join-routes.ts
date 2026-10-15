import type { FastifyPluginAsync } from 'fastify';
import { ErrorCodes, JoinBodySchema, type JoinInfo } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import { getGroupByInviteToken, joinWithEmail } from './service.js';

type TokenParams = { Params: { token: string } };

/** Public invite-link routes (the logo is in logo.ts). No auth: the token is the credential. */
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
};
