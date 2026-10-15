import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { fromNodeHeaders } from 'better-auth/node';
import type { AppDeps } from '../../deps.js';
import type { Auth } from './auth.js';
import { toSessionUser } from './session.js';

export const authRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (app) => {
  const { auth } = app;

  // better-auth's own endpoints, in a child plugin so its raw-body parser stays local.
  await app.register(async (child) => registerAuthHandler(child, auth));

  app.get('/me', async (request, reply) => {
    const { headers, response } = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers),
      returnHeaders: true,
    });
    forwardCookies(reply, headers); // sliding expiry: a refreshed session sends a new cookie
    const user = toSessionUser(response?.user);
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return user;
  });
};

/** Forwards `/api/auth/*` to better-auth as a Web Request. */
function registerAuthHandler(app: FastifyInstance, auth: Auth): void {
  // Keep the body as the raw string better-auth will parse itself. Any content type is
  // accepted, so an empty JSON body (e.g. a bare sign-out) is not rejected by Fastify.
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => done(null, body));

  app.route({
    method: ['GET', 'POST'],
    url: '/auth/*',
    handler: async (request, reply) => {
      const response = await auth.handler(toWebRequest(request));
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') reply.header(key, value);
      });
      forwardCookies(reply, response.headers);
      return reply.send(response.body ? await response.text() : null);
    },
  });
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
