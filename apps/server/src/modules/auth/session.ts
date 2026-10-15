import type { IncomingHttpHeaders } from 'node:http';
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import { SessionUserSchema, type SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';
import type { Auth } from './auth.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Set by `requireUser` / `requireAdmin`; null on routes without them. */
    user: SessionUser | null;
  }
}

type AuthUser = { id: string; email: string; name: string; role: string; disabledAt?: Date | null };

/**
 * Our view of better-auth's user; null for a disabled user even if a session still exists.
 * `groupId` is null here: group membership lives in the groups module, so only `/api/me`
 * (and the socket handshake) look it up. Do not read `request.user.groupId`; use
 * `getMembershipGroupId`.
 */
export function toSessionUser(
  authUser: AuthUser | undefined,
  groupId: string | null = null,
): SessionUser | null {
  if (!authUser || authUser.disabledAt) return null;
  const { id, email, name, role } = authUser;
  return SessionUserSchema.parse({ id, email, name, role, groupId }); // throws on an unknown role
}

/** The logged-in user from the request's session cookie, or null. */
export async function getSessionUser(
  auth: Auth,
  request: FastifyRequest,
): Promise<SessionUser | null> {
  return getSessionUserFromHeaders(auth, request.headers);
}

/** Same, from raw Node headers; the socket handshake has no Fastify request. */
export async function getSessionUserFromHeaders(
  auth: Auth,
  headers: IncomingHttpHeaders,
): Promise<SessionUser | null> {
  return (await getSessionFromHeaders(auth, headers))?.user ?? null;
}

/** The user and the id of the login session behind the headers, or null. */
export async function getSessionFromHeaders(
  auth: Auth,
  headers: IncomingHttpHeaders,
): Promise<{ user: SessionUser; sessionId: string } | null> {
  const result = await auth.api.getSession({ headers: fromNodeHeaders(headers) });
  const user = toSessionUser(result?.user);
  return result && user ? { user, sessionId: result.session.id } : null;
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
