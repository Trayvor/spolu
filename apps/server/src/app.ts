import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import type { Config } from './infra/config/config.js';
import type { Db } from './infra/db/client.js';
import { systemRoutes } from './modules/system/routes.js';

export type AppDeps = { config: Config; db: Db };

export async function buildApp({ config, db }: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: config.nodeEnv === 'test' ? false : { level: 'info' } });

  await app.register(systemRoutes, { prefix: '/api', config, db });

  registerNotFound(app);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
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
