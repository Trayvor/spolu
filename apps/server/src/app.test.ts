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
});
