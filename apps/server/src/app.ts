import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import type { AppDeps } from './deps.js';
import { attachSocket } from './infra/realtime/socket.js';
import { createAuth, type Auth } from './modules/auth/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { chatRoutes } from './modules/chat/routes.js';
import { filesRoutes } from './modules/files/routes.js';
import { joinRoutes } from './modules/groups/join-routes.js';
import { groupsRoutes } from './modules/groups/routes.js';
import { systemRoutes } from './modules/system/routes.js';
import { tasksRoutes } from './modules/tasks/routes.js';
import { usersRoutes } from './modules/users/routes.js';

/** Builds the HTTP app and attaches Socket.IO (`app.io`); `app.close()` closes both. */
export async function buildApp(
  deps: AppDeps,
  options: { logger?: boolean } = {},
): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger: (options.logger ?? config.nodeEnv !== 'test') ? { level: 'info' } : false,
    // The app port is reachable only through Caddy (deploy/docker-compose.yml publishes just
    // Caddy's ports). Trust one hop: Caddy's X-Forwarded-For entry is the real client, anything
    // a client prepended before it is ignored.
    // (A function: Fastify treats a plain number as "trust nothing".)
    trustProxy: (_address, hop) => hop < 1,
  });

  app.decorate('auth', createAuth(deps));
  app.decorate('io', attachSocket(app, config, app.auth, deps.db));
  // preClose runs before Fastify waits for the HTTP server, which open websockets would block.
  // io.close() also closes the HTTP server and is safe when the app never listened.
  app.addHook('preClose', async () => {
    await app.io.close();
  });

  app.decorateRequest('user', null);
  registerCsrfGuard(app, config);

  await app.register(systemRoutes, { prefix: '/api', deps });
  await app.register(authRoutes, { prefix: '/api', deps });
  await app.register(usersRoutes, { prefix: '/api', deps });
  await app.register(groupsRoutes, { prefix: '/api', deps });
  await app.register(filesRoutes, { prefix: '/api', deps });
  await app.register(joinRoutes, { prefix: '/api', deps });
  await app.register(tasksRoutes, { prefix: '/api', deps });
  await app.register(chatRoutes, { prefix: '/api', deps });

  registerNotFound(app);
  return app;
}

/**
 * CSRF guard for our own state-changing routes (the session cookie is SameSite=Lax, this is
 * defence in depth). A browser sends Sec-Fetch-Site and Origin on such requests; refuse when
 * either says the request came from elsewhere. Requests with neither header (curl, tests)
 * pass. /api/auth/* is skipped: better-auth checks Origin itself.
 */
function registerCsrfGuard(app: FastifyInstance, config: AppDeps['config']): void {
  const allowedOrigins = new Set([new URL(config.publicUrl).origin]);
  // In dev the browser is on Vite (:5173), whose proxy keeps the page's Origin header.
  if (config.nodeEnv === 'development') allowedOrigins.add('http://localhost:5173');
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

  app.addHook('onRequest', async (request, reply) => {
    if (safeMethods.has(request.method)) return;
    const path = request.url.split('?')[0] ?? '/';
    if (!isUnder(path, '/api') || isUnder(path, '/api/auth')) return;
    const site = request.headers['sec-fetch-site'];
    const origin = request.headers.origin;
    const crossSite = site !== undefined && site !== 'same-origin' && site !== 'none';
    const foreignOrigin = origin !== undefined && !allowedOrigins.has(origin);
    if (crossSite || foreignOrigin) return reply.code(403).send({ error: 'forbidden' });
  });
}

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
    /** The better-auth instance (`modules/auth/auth.ts`). */
    auth: Auth;
    /** Set by registerStatic: answers client-route requests with index.html. */
    spaFallback: ((reply: FastifyReply) => FastifyReply) | null;
  }
}

function isUnder(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/**
 * The single not-found handler. Unknown /api/*, /socket.io/*, non-GET requests and anything
 * that looks like a file answer JSON 404. Other GET/HEAD requests get the SPA index.html,
 * but only when static serving is registered.
 */
function registerNotFound(app: FastifyInstance): void {
  app.decorate('spaFallback', null);
  app.setNotFoundHandler((request, reply) => {
    const path = request.url.split('?')[0] ?? '/';
    const isClientRoute =
      (request.method === 'GET' || request.method === 'HEAD') &&
      !isUnder(path, '/api') &&
      !isUnder(path, '/socket.io') &&
      !path.startsWith('/assets/') &&
      !(path.split('/').pop() ?? '').includes('.');
    if (isClientRoute && app.spaFallback) return app.spaFallback(reply);
    return reply.code(404).send({ error: 'not_found' });
  });
}
