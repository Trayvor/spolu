import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { io as connect } from 'socket.io-client';
import { buildTestApp } from '../test/test-app.js';
import { loginAs } from '../test/login.js';
import { addAdmin } from './modules/users/service.js';

describe('buildApp', () => {
  it('exposes app.io and app.close() closes it', async () => {
    const { app, deps, close } = await buildTestApp();
    expect(app.io).toBeDefined();
    const email = `${randomUUID()}@example.com`;
    await addAdmin(deps.db, { email, name: 'App Test' });
    const cookie = await loginAs(app, email);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const client = connect(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      extraHeaders: { cookie },
    });
    await new Promise<void>((resolve) => client.on('connect', () => resolve()));

    const disconnected = new Promise<void>((resolve) => client.on('disconnect', () => resolve()));
    await app.close();
    await disconnected;
    client.close();
    await close();
  });

  it('app.close() works when the app never listened', async () => {
    const { app, close } = await buildTestApp();
    await app.ready();
    await app.close();
    await close();
  });

  it('GET /api answers JSON 404 { error: not_found }', async () => {
    const { app, close } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: 'not_found' });
    await app.close();
    await close();
  });

  it('request.ip comes from X-Forwarded-For (trustProxy)', async () => {
    const { app, close } = await buildTestApp();
    app.get('/test-ip', async (request) => request.ip);
    const res = await app.inject({
      method: 'GET',
      url: '/test-ip',
      headers: { 'x-forwarded-for': '203.0.113.7' },
    });
    expect(res.body).toBe('203.0.113.7');
    const spoofed = await app.inject({
      method: 'GET',
      url: '/test-ip',
      headers: { 'x-forwarded-for': '198.51.100.9, 203.0.113.7' },
    });
    expect(spoofed.body).toBe('203.0.113.7'); // only the nearest hop (the proxy) is trusted
    await app.close();
    await close();
  });

  describe('CSRF guard', () => {
    const post = async (url: string, headers: Record<string, string>, nodeEnv?: 'development') => {
      const { app, close } = await buildTestApp(nodeEnv ? { config: { nodeEnv } } : {});
      try {
        return await app.inject({ method: 'POST', url, headers, payload: {} });
      } finally {
        await app.close();
        await close();
      }
    };
    // Any /api route that exists; the guard runs before auth, so the answer is 401 when allowed.
    const url = '/api/groups';

    it('refuses a cross-site Sec-Fetch-Site and a foreign Origin with 403', async () => {
      const cases: Record<string, string>[] = [
        { 'sec-fetch-site': 'cross-site' },
        { 'sec-fetch-site': 'same-site' },
        { origin: 'https://evil.example' },
        { origin: 'null' },
      ];
      for (const headers of cases) {
        const res = await post(url, headers);
        expect(res.statusCode).toBe(403);
        expect(res.json()).toEqual({ error: 'forbidden' });
      }
    });

    it('lets the same origin, none and header-less requests through', async () => {
      const cases: Record<string, string>[] = [
        { 'sec-fetch-site': 'same-origin', origin: 'http://localhost:3000' },
        { 'sec-fetch-site': 'none' },
        { origin: 'http://localhost:3000' },
        {},
      ];
      for (const headers of cases) {
        expect((await post(url, headers)).statusCode).toBe(401);
      }
    });

    it('allows the Vite origin only in development, and never guards /api/auth or GET', async () => {
      const vite = { origin: 'http://localhost:5173' };
      expect((await post(url, vite)).statusCode).toBe(403);
      expect((await post(url, vite, 'development')).statusCode).toBe(401);
      expect(
        (await post('/api/auth/sign-out', { 'sec-fetch-site': 'cross-site' })).statusCode,
      ).not.toBe(403);
      const { app, close } = await buildTestApp();
      const get = await app.inject({
        method: 'GET',
        url: '/api/groups',
        headers: { 'sec-fetch-site': 'cross-site' },
      });
      expect(get.statusCode).toBe(401);
      await app.close();
      await close();
    });
  });
});
