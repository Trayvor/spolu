import type { FastifyPluginAsync, preHandlerAsyncHookHandler } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { ErrorCodes, type SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { createRateLimiter } from '../../infra/http/rate-limit.js';
import type { Auth } from '../auth/auth.js';
import { getSessionUser, requireAdmin } from '../auth/session.js';
import { getUserById, setFinanceAccess } from '../users/service.js';
import { moveFinanceSockets } from './events.js';
import { canGrantFinance, canSeeFinance } from './policy.js';
import type { AuditActor } from '../audit/actor.js';
import { auditActorOf } from '../audit/request-actor.js';

/**
 * preHandler of every finance route (the plugin in `routes.ts`): 401 without a session, 403
 * without the finance right, otherwise sets `request.user`.
 */
export function requireFinance(auth: Auth): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const user = await getSessionUser(auth, request);
    if (!user) return reply.code(401).send({ error: ErrorCodes.unauthorized });
    if (!canSeeFinance(user)) return reply.code(403).send({ error: ErrorCodes.forbidden });
    request.user = user;
  };
}

/** The actor may not grant at all (403). */
class FinanceGrantForbiddenError extends Error {
  constructor() {
    super('Only the superadmin grants the finance right');
    this.name = 'FinanceGrantForbiddenError';
  }
}

/** The target is no active admin: a client, an unknown id, a disabled admin, the superadmin (404). */
class FinanceTargetNotFoundError extends Error {
  constructor() {
    super('No active admin with that id');
    this.name = 'FinanceTargetNotFoundError';
  }
}

type AccessDeps = { db: Db; io: SocketIOServer };

async function changeFinance(
  { db, io }: AccessDeps,
  actor: SessionUser,
  targetId: string,
  grant: boolean,
  by?: AuditActor,
): Promise<{ changed: boolean }> {
  if (actor.role !== 'superadmin') throw new FinanceGrantForbiddenError();
  const target = await getUserById(db, targetId);
  if (!target || !canGrantFinance(actor, target)) throw new FinanceTargetNotFoundError();
  const changed = await setFinanceAccess(db, targetId, grant ? actor.id : null, by);
  // A repeat changes nothing and pushes nothing.
  if (changed) await moveFinanceSockets(io, targetId, grant);
  return { changed };
}

/** Grants the right (idempotent). Throws `FinanceGrantForbiddenError` / `FinanceTargetNotFoundError`. */
function grantFinance(deps: AccessDeps, actor: SessionUser, targetId: string, by?: AuditActor) {
  return changeFinance(deps, actor, targetId, true, by);
}

/** Removes the right (idempotent). Same errors as `grantFinance`. */
function revokeFinance(deps: AccessDeps, actor: SessionUser, targetId: string, by?: AuditActor) {
  return changeFinance(deps, actor, targetId, false, by);
}

/** Grants and removals per minute per superadmin, like the manager routes. */
const GRANTS_PER_MINUTE = 120;

/** `PUT` / `DELETE /api/admins/:id/finance-access`: the superadmin's switch on the Admins page. */
export const financeAccessRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { db } },
) => {
  const preHandler = requireAdmin(app.auth);
  const allow = createRateLimiter({ windowMs: 60_000, max: GRANTS_PER_MINUTE });

  for (const [method, grant] of [
    ['PUT', true],
    ['DELETE', false],
  ] as const) {
    app.route<{ Params: { id: string } }>({
      method,
      url: '/admins/:id/finance-access',
      preHandler,
      handler: async (request, reply) => {
        const actor = request.user!;
        if (!allow(actor.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
        try {
          await (grant ? grantFinance : revokeFinance)(
            { db, io: app.io },
            actor,
            request.params.id,
            auditActorOf(request),
          );
        } catch (error) {
          if (error instanceof FinanceGrantForbiddenError) {
            return reply.code(403).send({ error: ErrorCodes.forbidden });
          }
          if (error instanceof FinanceTargetNotFoundError) {
            return reply.code(404).send({ error: ErrorCodes.notFound });
          }
          throw error;
        }
        return reply.code(204).send();
      },
    });
  }
};
