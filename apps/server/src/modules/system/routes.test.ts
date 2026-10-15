import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@spolu/shared';
import { buildApp } from '../../app.js';
import { createDb } from '../../infra/db/client.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';

describe('system routes', () => {
  const config = testConfig();
  const good = createDb(testDatabaseUrl);
  const bad = createDb('postgres://x:x@localhost:1/x');
  let app: FastifyInstance;
  let degraded: FastifyInstance;

  beforeAll(async () => {
    app = await buildApp({ config, db: good.db });
    degraded = await buildApp({ config, db: bad.db });
  });
  afterAll(async () => {
    await app.close();
    await degraded.close();
    await good.close();
    await bad.close();
  });

  it('GET /api/health is 200 ok with a reachable database', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    const body = HealthResponseSchema.parse(res.json());
    expect(body).toEqual({ status: 'ok', db: 'ok', version: 'test-sha' });
  });

  it('GET /api/health is 503 degraded when the database is down', async () => {
    const res = await degraded.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(503);
    expect(HealthResponseSchema.parse(res.json())).toEqual({
      status: 'degraded',
      db: 'down',
      version: 'test-sha',
    });
  });

  it('unknown /api/* is a JSON 404', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
