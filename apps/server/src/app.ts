import Fastify, { type FastifyInstance } from 'fastify';
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

/** Unknown /api/* answers JSON 404. Task 9 extends this one handler with the SPA fallback. */
function registerNotFound(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ error: 'not_found' });
  });
}
