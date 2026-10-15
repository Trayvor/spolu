import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import type { AppDeps } from './deps.js';
import { attachSocket } from './infra/realtime/socket.js';
import { systemRoutes } from './modules/system/routes.js';

/** Builds the HTTP app and attaches Socket.IO (`app.io`); `app.close()` closes both. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({ logger: config.nodeEnv === 'test' ? false : { level: 'info' } });

  app.decorate('io', attachSocket(app, config));
  // preClose runs before Fastify waits for the HTTP server, which open websockets would block.
  // io.close() also closes the HTTP server and is safe when the app never listened.
  app.addHook('preClose', async () => {
    await app.io.close();
  });

  await app.register(systemRoutes, { prefix: '/api', deps });

  registerNotFound(app);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    io: SocketIOServer;
    /** Set by registerStatic: answers client-route requests with index.html. */
    spaFallback: ((reply: FastifyReply) => FastifyReply) | null;
  }
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
      !path.startsWith('/api/') &&
      !path.startsWith('/socket.io/') &&
      !path.startsWith('/assets/') &&
      !(path.split('/').pop() ?? '').includes('.');
    if (isClientRoute && app.spaFallback) return app.spaFallback(reply);
    return reply.code(404).send({ error: 'not_found' });
  });
}
