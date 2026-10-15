import type { FastifyPluginAsync } from 'fastify';
import type { HealthResponse } from '@ehub/shared';
import type { Config } from '../../infra/config/config.js';
import { pingDb, type Db } from '../../infra/db/client.js';

export const systemRoutes: FastifyPluginAsync<{ config: Config; db: Db }> = async (
  app,
  { config, db },
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
