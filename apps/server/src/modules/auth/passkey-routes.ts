import type { FastifyPluginAsync, FastifyReply, preHandlerAsyncHookHandler } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { ErrorCodes, PasskeyCreateBodySchema, PasskeyOptionsBodySchema } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter, createSlidingRateLimiter } from '../../infra/http/rate-limit.js';
import { isAdmin } from '../users/policy.js';
import {
  deletePasskey,
  finishRegistration,
  isFreshSession,
  listPasskeys,
  PasskeyInvalidError,
  PasskeyLimitError,
  registrationOptions,
  sendReauthCode,
  useReauthCode,
} from './passkeys.js';
import { toSessionUser } from './session.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by the passkey routes' preHandler: when the login session began. */
    sessionCreatedAt?: Date;
  }
}

type IdParams = { Params: { id: string } };

const send = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ error });

/**
 * The signed-in admin's own passkeys (ADR 0050), in Settings. Every route acts on the session's
 * user only. A real login session is required (no in-process call on a user's behalf, so not
 * reachable from MCP): adding a passkey needs a session younger than
 * `PASSKEY_FRESH_SESSION_MINUTES` or the emailed re-check code.
 */
export const passkeyRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  // Per user, in memory (one process). Re-check codes: 5 a minute and 20 a rolling day (each
  // is an email); options and finishes: 10 a minute.
  const allowCodePerMinute = createRateLimiter({ windowMs: 60_000, max: 5 });
  const allowCodePerDay = createSlidingRateLimiter({ windowMs: 86_400_000, max: 20 });
  const allowOptions = createRateLimiter({ windowMs: 60_000, max: 10 });
  const allowFinish = createRateLimiter({ windowMs: 60_000, max: 10 });

  const adminSession: preHandlerAsyncHookHandler = async (request, reply) => {
    const result = await app.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    const sessionUser = toSessionUser(result?.user);
    if (!result || !sessionUser) return send(reply, 401, ErrorCodes.unauthorized);
    if (!isAdmin(sessionUser)) return send(reply, 403, ErrorCodes.forbidden);
    request.user = sessionUser;
    request.sessionCreatedAt = new Date(result.session.createdAt);
  };

  app.get('/me/passkeys', { preHandler: adminSession }, async (request) =>
    listPasskeys(db, request.user!.id),
  );

  app.post('/me/passkeys/reauth', { preHandler: adminSession }, async (request, reply) => {
    const id = request.user!.id;
    if (!allowCodePerMinute(id) || !allowCodePerDay(id)) {
      return send(reply, 429, ErrorCodes.rateLimited);
    }
    await sendReauthCode(deps, request.user!);
    return reply.code(204).send();
  });

  app.post('/me/passkeys/options', { preHandler: adminSession }, async (request, reply) => {
    if (!allowOptions(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = PasskeyOptionsBodySchema.safeParse(request.body ?? {});
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    if (!isFreshSession(request.sessionCreatedAt!)) {
      if (body.data.code === undefined) return send(reply, 403, ErrorCodes.reauthRequired);
      if (!(await useReauthCode(deps, request.user!.id, body.data.code))) {
        return send(reply, 400, ErrorCodes.invalidCode);
      }
    }
    try {
      return await registrationOptions(deps, request.user!);
    } catch (error) {
      if (error instanceof PasskeyLimitError) return send(reply, 409, ErrorCodes.passkeyLimit);
      throw error;
    }
  });

  app.post('/me/passkeys', { preHandler: adminSession }, async (request, reply) => {
    if (!allowFinish(request.user!.id)) return send(reply, 429, ErrorCodes.rateLimited);
    const body = PasskeyCreateBodySchema.safeParse(request.body);
    if (!body.success) return send(reply, 400, ErrorCodes.validationFailed);
    try {
      const created = await finishRegistration(deps, request.user!, body.data, request.log);
      return reply.code(201).send(created);
    } catch (error) {
      if (error instanceof PasskeyInvalidError) return send(reply, 400, ErrorCodes.passkeyInvalid);
      if (error instanceof PasskeyLimitError) return send(reply, 409, ErrorCodes.passkeyLimit);
      throw error;
    }
  });

  app.delete<IdParams>('/me/passkeys/:id', { preHandler: adminSession }, async (request, reply) => {
    const deleted = await deletePasskey(db, request.user!.id, request.params.id);
    if (!deleted) return send(reply, 404, ErrorCodes.notFound);
    return reply.code(204).send();
  });
};
