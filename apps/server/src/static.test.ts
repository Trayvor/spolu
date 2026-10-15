import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from './app.js';
import { registerStatic } from './static.js';
import { createDb } from './infra/db/client.js';
import { testConfig, testDatabaseUrl } from '../test/test-config.js';

const INDEX = '<!doctype html><title>eHub</title>';

describe('static web serving', () => {
  const { db, close } = createDb(testDatabaseUrl);
  let dir: string;
  let app: FastifyInstance;
  let plain: FastifyInstance;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ehub-web-'));
    await mkdir(join(dir, 'assets'));
    await writeFile(join(dir, 'index.html'), INDEX);
    await writeFile(join(dir, 'assets', 'a.js'), 'console.log(1)');
    app = await buildApp({ config: testConfig(), db });
    await registerStatic(app, dir);
    plain = await buildApp({ config: testConfig(), db });
  });
  afterAll(async () => {
    await app.close();
    await plain.close();
    await close();
    await rm(dir, { recursive: true, force: true });
  });

  it.each(['/', '/settings', '/groups/42/chat'])('GET %s serves index.html', async (url) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe(INDEX);
  });

  it('serves an asset file with a long immutable cache', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/a.js' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('console.log(1)');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });

  it('a missing asset is a 404, not index.html', async () => {
    for (const url of ['/assets/missing.js', '/assets/nofile']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toContain('<title>');
    }
  });

  it('unknown /api/* and /socket.io/* are JSON 404', async () => {
    for (const url of ['/api/nope', '/socket.io/nope']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
  });

  it('a non-GET unknown route is a JSON 404', async () => {
    const res = await app.inject({ method: 'POST', url: '/settings' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });

  it('without static serving, client routes are JSON 404', async () => {
    const res = await plain.inject({ method: 'GET', url: '/settings' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
  });
});
