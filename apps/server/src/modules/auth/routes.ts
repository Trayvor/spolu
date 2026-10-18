import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import {
  EmailChangeConfirmSchema,
  EmailChangeRequestSchema,
  ErrorCodes,
  LanguageBodySchema,
  NameBodySchema,
  type Me,
  type MeGroup,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { createRateLimiter, createSlidingRateLimiter } from '../../infra/http/rate-limit.js';
import type { Auth } from './auth.js';
import {
  confirmEmailChange,
  InvalidCodeError,
  requestEmailChange,
  ReservedEmailError,
  SameEmailError,
} from './email-change.js';
import { getSessionFromHeaders, requireUser, toSessionUser } from './session.js';
import { PASSKEY_OPTIONS_PATH, PASSKEY_SIGN_IN_PATH } from './passkey-login.js';
import { TICKET_LINK_PATH, ticketTokenLogId } from './ticket-link.js';
import { listMemberships } from '../groups/memberships.js';
import { EmailTakenError, setUserLanguage, updateUserName } from '../users/service.js';
import { sessionRoom } from '../../infra/realtime/rooms.js';

export const authRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app, { deps }) => {
  const { db } = deps;
  const { auth } = app;
  const preHandler = requireUser(auth);
  // Email-change limits, in memory (one process; a restart resets them). Per user: 10 requests
  // a minute (the login code's plugin limit) and 20 in a rolling day. Per target address, across
  // users: 5 an hour, so no one floods someone's inbox. Confirms: 10 a minute per user.
  const allowChangePerMinute = createRateLimiter({ windowMs: 60_000, max: 10 });
  const allowChangePerDay = createSlidingRateLimiter({ windowMs: 86_400_000, max: 20 });
  const allowChangeToAddress = createSlidingRateLimiter({ windowMs: 3_600_000, max: 5 });
  const allowConfirm = createRateLimiter({ windowMs: 60_000, max: 10 });

  // The ticket email's sign-in link, per address: the login code's limit (10 a minute). The
  // token's 256 bits are the guard against guessing; this only stops floods.
  const allowTicketLink = createRateLimiter({
    windowMs: 60_000,
    max: deps.config.loginCodesPerMinute,
  });

  // The passkey login (ADR 0050), per address: the sign-in at the login code's limit, the
  // options six times that (the login page asks for them on every visit, for autofill).
  const allowPasskeySignIn = createRateLimiter({
    windowMs: 60_000,
    max: deps.config.loginCodesPerMinute,
  });
  const allowPasskeyOptions = createRateLimiter({
    windowMs: 60_000,
    max: deps.config.loginCodesPerMinute * 6,
  });
  const limits: Record<string, (ip: string) => boolean> = {
    [`/api/auth${TICKET_LINK_PATH}`]: allowTicketLink,
    [`/api/auth${PASSKEY_SIGN_IN_PATH}`]: allowPasskeySignIn,
    [`/api/auth${PASSKEY_OPTIONS_PATH}`]: allowPasskeyOptions,
  };

  // better-auth's own endpoints, in a child plugin so its raw-body parser stays local.
  await app.register(async (child) => registerAuthHandler(child, auth, limits));

  const meGroups = async (u: SessionUser): Promise<MeGroup[]> =>
    u.role === 'client'
      ? (await listMemberships(db, u.id)).map((m) => ({
          id: m.groupId,
          name: m.name,
          role: m.role,
          hasLogo: m.hasLogo,
          updatedAt: m.updatedAt.toISOString(),
        }))
      : [];

  /** The caller with their groups; null when there is no valid, enabled session. */
  const currentUser = async (request: FastifyRequest) => {
    const { headers, response } = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    const base = toSessionUser(response?.user);
    if (!base) return null;
    const user: Me = { ...base, groups: await meGroups(base) };
    return { user, headers };
  };

  app.get('/me', async (request, reply) => {
    const current = await currentUser(request);
    if (!current) return reply.code(401).send({ error: ErrorCodes.unauthorized });
    // Sliding expiry: a refreshed session sends a new cookie. Only for a valid, enabled user.
    forwardCookies(reply, current.headers);
    return current.user;
  });

  // Own name only: the id comes from the session, never from the body.
  app.patch('/me', async (request, reply) => {
    const current = await currentUser(request);
    if (!current) return reply.code(401).send({ error: ErrorCodes.unauthorized });
    const body = NameBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    await updateUserName(db, current.user.id, body.data.name);
    return { ...current.user, name: body.data.name };
  });

  // Email change and language act on the session's user only; no route names another user.
  app.post('/me/email-change', { preHandler }, async (request, reply) => {
    const user = request.user!;
    if (!allowChangePerMinute(user.id) || !allowChangePerDay(user.id)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
    const body = EmailChangeRequestSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    if (!allowChangeToAddress(body.data.newEmail)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
    try {
      await requestEmailChange(deps, user, body.data.newEmail);
    } catch (error) {
      if (error instanceof SameEmailError || error instanceof ReservedEmailError) {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }
      throw error;
    }
    return reply.code(204).send();
  });

  app.post('/me/email-change/confirm', { preHandler }, async (request, reply) => {
    const user = request.user!;
    if (!allowConfirm(user.id)) return reply.code(429).send({ error: ErrorCodes.rateLimited });
    const body = EmailChangeConfirmSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    try {
      await confirmEmailChange(deps, user, body.data.newEmail, body.data.code, request.log);
    } catch (error) {
      if (error instanceof ReservedEmailError) {
        return reply.code(400).send({ error: ErrorCodes.validationFailed });
      }
      if (error instanceof InvalidCodeError) {
        return reply.code(400).send({ error: ErrorCodes.invalidCode });
      }
      if (error instanceof EmailTakenError) {
        return reply.code(409).send({ error: ErrorCodes.emailTaken });
      }
      throw error;
    }
    const me: Me = { ...user, email: body.data.newEmail, groups: await meGroups(user) };
    return me;
  });

  app.put('/me/language', { preHandler }, async (request, reply) => {
    const body = LanguageBodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: ErrorCodes.validationFailed });
    await setUserLanguage(db, request.user!.id, body.data.language);
    return reply.code(204).send();
  });
};

/**
 * The better-auth endpoints the app uses. An allow-list, not `/auth/*`: the library has
 * many more (e.g. `update-user` lets a user edit their own record past our policies), and
 * new library versions add more. Anything else under /api/auth answers our JSON 404.
 */
const AUTH_ENDPOINTS = [
  { method: 'POST', path: '/email-otp/send-verification-otp' },
  { method: 'POST', path: '/sign-in/email-otp' },
  { method: 'POST', path: '/sign-out' },
  { method: 'POST', path: TICKET_LINK_PATH }, // ours, ticket-link.ts
  { method: 'POST', path: PASSKEY_OPTIONS_PATH }, // ours, passkey-login.ts
  { method: 'POST', path: PASSKEY_SIGN_IN_PATH },
] as const;

/**
 * Forwards the allowed `/api/auth/...` endpoints to better-auth as a Web Request. `limits`: a
 * per-address rate limit of some routes (the full `/api/auth/...` path).
 */
function registerAuthHandler(
  app: FastifyInstance,
  auth: Auth,
  limits: Record<string, (ip: string) => boolean>,
): void {
  // Keep the body as the raw string better-auth will parse itself. Any content type is
  // accepted, so an empty JSON body (e.g. a bare sign-out) is not rejected by Fastify.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    const route = request.routeOptions.url;
    const ticketLink = route === `/api/auth${TICKET_LINK_PATH}`;
    const allow = route ? limits[route] : undefined;
    if (allow && !allow(request.ip)) {
      return reply.code(429).send({ error: ErrorCodes.rateLimited });
    }
    // A ticket link or a passkey may end another user's session.
    const replaces = ticketLink || route === `/api/auth${PASSKEY_SIGN_IN_PATH}`;
    // Sign-out, and a sign-in that may end another session: remember the session before
    // better-auth deletes it.
    const before =
      route === '/api/auth/sign-out' || replaces
        ? await getSessionFromHeaders(auth, request.headers)
        : null;
    const response = await auth.handler(toWebRequest(request));
    if (ticketLink) {
      // Never the token, nor its full hash: a prefix is enough to match the database row.
      request.log.info(
        { ticketLink: ticketTokenLogId(tokenOf(request.body)), status: response.status },
        'ticket link sign-in',
      );
    }
    // The old session is gone after a sign-out, or after a sign-in that replaced another user's.
    const gone =
      before !== null &&
      response.status === 200 &&
      (!replaces || (await getSessionFromHeaders(auth, request.headers)) === null);
    if (gone) app.io.in(sessionRoom(before.sessionId)).disconnectSockets(true);
    reply.status(response.status);
    response.headers.forEach((value, key) => {
      if (key !== 'set-cookie') reply.header(key, value);
    });
    forwardCookies(reply, response.headers);
    return reply.send(response.body ? await response.text() : null);
  };
  for (const { method, path } of AUTH_ENDPOINTS) {
    app.route({ method, url: `/auth${path}`, handler });
  }
}

/** The `token` of a ticket link's raw JSON body, or '' (only for the log line). */
function tokenOf(body: unknown): string {
  try {
    const token = (JSON.parse(String(body)) as { token?: unknown }).token;
    return typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = fromNodeHeaders(request.headers);
  // better-auth rate-limits by this header. Replace whatever the client sent with the
  // address Fastify resolved (trustProxy: Caddy's X-Forwarded-For).
  headers.set('x-forwarded-for', request.ip);
  const body = typeof request.body === 'string' && request.body !== '' ? request.body : undefined;
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  return new Request(url, { method: request.method, headers, body });
}

/** Every Set-Cookie must go out as its own header, so pass them as an array. */
function forwardCookies(reply: FastifyReply, headers: Headers): void {
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) reply.header('set-cookie', cookies);
}
