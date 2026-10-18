import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { internalCallUser, runAsUser } from '../auth/internal-calls.js';
import { requireUser } from '../auth/session.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import type { AuditActor } from './actor.js';
import { auditActorOf } from './request-actor.js';

describe('auditActorOf', () => {
  let test: Awaited<ReturnType<typeof buildTestApp>>;
  let app: FastifyInstance;
  let admin: { id: string; email: string; name: string };
  let seen: AuditActor | null = null;

  beforeAll(async () => {
    test = await buildTestApp();
    app = test.app;
    // A throwaway route registered after the app (Fastify allows it before ready()).
    app.get('/api/__audit-actor-test', { preHandler: requireUser(app.auth) }, async (request) => {
      seen = auditActorOf(request);
      return { ok: true };
    });
    const email = `${randomUUID()}@example.com`;
    admin = { ...(await addAdmin(test.deps.db, { email, name: 'Jana Nováková' })), email };
  });
  afterAll(async () => {
    await deactivateUser(test.deps.db, admin.id);
    await app.close();
    await test.close();
  });

  it('a cookie session gives a user actor', async () => {
    const cookie = await loginAs(app, admin.email);
    const res = await app.inject({ url: '/api/__audit-actor-test', headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(seen).toEqual({ kind: 'user', userId: admin.id, name: 'Jana Nováková' });
  });

  it('an MCP token call gives an mcp actor with the token id and name', async () => {
    // The app's MCP guard lets internal calls reach allowlisted routes only: a bare app here.
    const bare = Fastify();
    bare.decorateRequest('user', null);
    bare.get('/x', async (request) => {
      request.user = internalCallUser(request.headers);
      seen = auditActorOf(request);
      return { ok: true };
    });
    const user = {
      id: admin.id,
      email: admin.email,
      name: 'Jana Nováková',
      role: 'admin' as const,
      finance: false,
    };
    const res = await runAsUser(user, (headers) => bare.inject({ url: '/x', headers }), {
      kind: 'mcp',
      tokenId: 'tok-1',
      tokenName: 'Claude Desktop',
    });
    expect(res.statusCode).toBe(200);
    await bare.close();
    expect(seen).toEqual({
      kind: 'mcp',
      userId: admin.id,
      name: 'Jana Nováková',
      tokenId: 'tok-1',
      tokenName: 'Claude Desktop',
    });
  });

  it('throws without a user', () => {
    expect(() => auditActorOf({ user: null, headers: {} } as never)).toThrow();
  });
});
