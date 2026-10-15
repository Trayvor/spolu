import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AppDeps } from '../../deps.js';
import type { Auth } from './auth.js';
import { getSessionFromHeaders, toSessionUser } from './session.js';
import { sessionRoom } from '../../infra/realtime/rooms.js';

export const authRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app) => {
  const { auth } = app;

  // better-auth's own endpoints, in a child plugin so its raw-body parser stays local.
  await app.register(async (child) => registerAuthHandler(child, auth));

  app.get('/me', async (request, reply) => {
    const { headers, response } = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    const user = toSessionUser(response?.user);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    // Sliding expiry: a refreshed session sends a new cookie. Only for a valid, enabled user.
    forwardCookies(reply, headers);
    return user;
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
] as const;

/** Forwards the allowed `/api/auth/...` endpoints to better-auth as a Web Request. */
function registerAuthHandler(app: FastifyInstance, auth: Auth): void {
  // Keep the body as the raw string better-auth will parse itself. Any content type is
  // accepted, so an empty JSON body (e.g. a bare sign-out) is not rejected by Fastify.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  const handler = async (request: FastifyRequest, reply: FastifyReply) => {
    // Sign-out: remember whose session it is before better-auth deletes it.
    const signingOut =
      request.method === 'POST' && request.url.endsWith('/sign-out')
        ? await getSessionFromHeaders(auth, request.headers)
        : null;
    const response = await auth.handler(toWebRequest(request));
    if (signingOut && response.status === 200) {
      app.io.in(sessionRoom(signingOut.sessionId)).disconnectSockets(true);
    }
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
