import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { pingDb } from '../../infra/db/client.js';

export const systemRoutes: FastifyPluginAsync<{ deps: AppDeps }> = async (
  app,
  { deps: { config, db } },
) => {
  app.get('/health', async (_request, reply) => {
    const dbUp = await pingDb(db);
    const body: HealthResponse = {
      status: dbUp ? 'ok' : 'degraded',
      db: dbUp ? 'ok' : 'down',
      version: config.appVersion,
    };
    return reply.code(dbUp ? 200 : 503).send(body);
  });
};
