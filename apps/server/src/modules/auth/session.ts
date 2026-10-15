import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { Role, SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';
import type { Auth } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireUser` / `requireAdmin`; null on routes without them. */
    user: SessionUser | null;
  }
}

type AuthUser = { id: string; email: string; name: string; role: string; disabledAt?: Date | null };

/** Our view of better-auth's user; null for a disabled user even if a session still exists. */
export function toSessionUser(authUser: AuthUser | undefined): SessionUser | null {
  if (!authUser || authUser.disabledAt) return null;
  const { id, email, name, role } = authUser;
  return { id, email, name, role: role as Role };
}

/** The logged-in user from the request's session cookie, or null. */
export async function getSessionUser(
  auth: Auth,
  request: FastifyRequest,
): Promise<SessionUser | null> {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
  return toSessionUser(result?.user);
}

function unauthorized(reply: FastifyReply): FastifyReply {
  return reply.code(401).send({ error: 'unauthorized' });
}

/** preHandler: 401 without a valid session, otherwise sets `request.user`. */
export function requireUser(auth: Auth): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const user = await getSessionUser(auth, request);
    if (!user) return unauthorized(reply);
    request.user = user;
  };
}

/** preHandler: 401 without a session, 403 for a non-admin, otherwise sets `request.user`. */
export function requireAdmin(auth: Auth): preHandlerAsyncHookHandler {
  return async (request, reply) => {
    const user = await getSessionUser(auth, request);
    if (!user) return unauthorized(reply);
    if (!isAdmin(user)) return reply.code(403).send({ error: 'forbidden' });
    request.user = user;
  };
}
