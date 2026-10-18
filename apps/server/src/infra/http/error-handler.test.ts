import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';

describe('root error handler', () => {
  it('answers a DB error with 500 internal_error, without the SQL, and logs it', async () => {
    const lines: string[] = [];
    const { app, deps, close } = await buildTestApp({
      logStream: { write: (line) => void lines.push(line) },
    });
    app.get('/test-db-error', async () => {
      await deps.db.execute(sql`select secret_column from no_such_table where id = ${'leak-me'}`);
      return 'unreachable';
    });
    const res = await app.inject({ method: 'GET', url: '/test-db-error' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });
    expect(res.body).not.toMatch(/no_such_table|secret_column|leak-me|select/i);
    // The full error stays in the server log.
    expect(lines.join('\n')).toContain('no_such_table');
    await app.close();
    await close();
  });

  it('answers a thrown plain error with 500 internal_error', async () => {
    const { app, close } = await buildTestApp();
    app.get('/test-throw', async () => {
      throw new Error('internal detail');
    });
    const res = await app.inject({ method: 'GET', url: '/test-throw' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal_error' });
    await app.close();
    await close();
  });

  it('keeps Fastify 4xx answers, such as a malformed JSON body', async () => {
    const { app, close } = await buildTestApp();
    app.post('/test-json', async () => 'ok');
    const res = await app.inject({
      method: 'POST',
      url: '/test-json',
      headers: { 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ statusCode: 400, code: 'FST_ERR_CTP_INVALID_JSON_BODY' });
    await app.close();
    await close();
  });

  it("keeps a route's own error codes", async () => {
    const { app, close } = await buildTestApp();
    const res = await app.inject({ method: 'GET', url: '/api/admins' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).not.toBe('internal_error');
    await app.close();
    await close();
  });
});
