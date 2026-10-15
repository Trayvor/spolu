import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import type { AppDeps } from './deps.js';
import { attachSocket } from './infra/realtime/socket.js';
import { createAuth, type Auth } from './modules/auth/auth.js';
import { authRoutes } from './modules/auth/routes.js';
import { systemRoutes } from './modules/system/routes.js';
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
  app.decorate('io', attachSocket(app, config, app.auth));
  // preClose runs before Fastify waits for the HTTP server, which open websockets would block.
  // io.close() also closes the HTTP server and is safe when the app never listened.
  app.addHook('preClose', async () => {
    await app.io.close();
  });

  app.decorateRequest('user', null);

  await app.register(systemRoutes, { prefix: '/api', deps });
  await app.register(authRoutes, { prefix: '/api', deps });
  await app.register(usersRoutes, { prefix: '/api', deps });

  registerNotFound(app);
  return app;
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
