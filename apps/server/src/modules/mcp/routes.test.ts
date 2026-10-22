import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { McpToken, McpTokenCreated } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { emailWithSubject } from '../../../test/mail.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { createGroup } from '../groups/service.js';
import { addMembership } from '../groups/memberships.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setUserLanguage,
} from '../users/service.js';
import { recordWriteCall } from './audit.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('MCP token routes', () => {
  let test: TestApp;
  let admin: { id: string; cookie: string };
  let other: { id: string; cookie: string };
  let clientCookie: string;
  let requesterCookie: string;
  const admins: string[] = [];

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: cookie ? { cookie } : {}, payload });
  const create = (
    cookie: string,
    body: object = { name: 'Claude', scope: 'read', expiresInDays: 90 },
  ) => call('POST', '/api/me/mcp/tokens', cookie, body);

  beforeAll(async () => {
    test = await buildTestApp();
    const db = test.deps.db;
    for (const target of ['admin', 'other'] as const) {
      const email = `${randomUUID()}@example.com`;
      const row = await addAdmin(db, { email, name: target });
      admins.push(row.id);
      const value = { id: row.id, cookie: await loginAs(test.app, email) };
      if (target === 'admin') admin = value;
      else other = value;
    }
    const group = await createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const clientEmail = `${randomUUID()}@example.com`;
    const client = await createUnverifiedClient(db, clientEmail, 'Cyril');
    await addMembership(db, client.id, group.id, 'client');
    clientCookie = await loginAs(test.app, clientEmail);
    const requesterEmail = `${randomUUID()}@example.com`;
    const requester = await createUnverifiedClient(db, requesterEmail, 'Zia');
    await addMembership(db, requester.id, group.id, 'ziadatel');
    requesterCookie = await loginAs(test.app, requesterEmail);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('an admin creates a token, sees it once, lists and revokes it', async () => {
    const res = await create(admin.cookie);
    expect(res.statusCode, res.body).toBe(201);
    const created = res.json<McpTokenCreated>();
    expect(created.token).toMatch(/^spolu_mcp_/);
    const list = await call('GET', '/api/me/mcp/tokens', admin.cookie);
    expect(list.statusCode).toBe(200);
    const items = list.json<McpToken[]>();
    expect(items.map((t) => t.id)).toContain(created.item.id);
    expect(list.body).not.toContain(created.token);

    // Another admin neither sees nor revokes it.
    const theirs = await call('GET', '/api/me/mcp/tokens', other.cookie);
    expect(theirs.json<McpToken[]>().map((t) => t.id)).not.toContain(created.item.id);
    const foreign = await call('DELETE', `/api/me/mcp/tokens/${created.item.id}`, other.cookie);
    expect(foreign.statusCode).toBe(404);

    const revoke = await call('DELETE', `/api/me/mcp/tokens/${created.item.id}`, admin.cookie);
    expect(revoke.statusCode).toBe(204);
    const again = await call('DELETE', `/api/me/mcp/tokens/${created.item.id}`, admin.cookie);
    expect(again.statusCode).toBe(404);
  });

  it('emails the owner when a token is made, without the token', async () => {
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email, name: 'Mailed' });
    admins.push(row.id);
    await setUserLanguage(test.deps.db, row.id, 'en');
    const cookie = await loginAs(test.app, email);
    const res = await create(cookie, { name: 'Laptop Claude', scope: 'read', expiresInDays: 7 });
    expect(res.statusCode).toBe(201);
    const { token } = res.json<McpTokenCreated>();
    const t = serverTexts('en').mcp.tokenCreated;
    const caught = await emailWithSubject(email, t.subject);
    expect(caught.subject).toBe(t.subject);
    expect(caught.text).toContain('Laptop Claude');
    expect(caught.text).toContain('revoke');
    expect(caught.text).toContain(`${test.deps.config.publicUrl}/settings`);
    expect(caught.text).not.toContain(token);
  });

  it('refuses a bad body', async () => {
    const res = await create(admin.cookie, { name: 'x', scope: 'root', expiresInDays: 90 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'validation_failed' });
  });

  it('a manager creates, lists and revokes their own token (ADR 0071)', async () => {
    const res = await create(clientCookie);
    expect(res.statusCode, res.body).toBe(201);
    const { item } = res.json<McpTokenCreated>();
    const list = await call('GET', '/api/me/mcp/tokens', clientCookie);
    expect(list.json<McpToken[]>().map((t) => t.id)).toEqual([item.id]);
    expect((await call('GET', '/api/me/mcp/audit', clientCookie)).statusCode).toBe(200);
    // Not an admin's to see.
    const theirs = await call('GET', '/api/me/mcp/tokens', admin.cookie);
    expect(theirs.json<McpToken[]>().map((t) => t.id)).not.toContain(item.id);
    expect((await call('DELETE', `/api/me/mcp/tokens/${item.id}`, clientCookie)).statusCode).toBe(
      204,
    );
  });

  it('a žiadateľ gets 403 on every route', async () => {
    expect((await create(requesterCookie)).statusCode).toBe(403);
    expect((await call('GET', '/api/me/mcp/tokens', requesterCookie)).statusCode).toBe(403);
    expect((await call('GET', '/api/me/mcp/audit', requesterCookie)).statusCode).toBe(403);
    expect((await call('DELETE', '/api/me/mcp/tokens/x', requesterCookie)).statusCode).toBe(403);
  });

  it('no session gets 401', async () => {
    expect((await create('')).statusCode).toBe(401);
    expect((await call('GET', '/api/me/mcp/tokens')).statusCode).toBe(401);
  });

  it('the audit list is the caller’s own, without content', async () => {
    const res = await create(admin.cookie, { name: 'Writer', scope: 'write', expiresInDays: 7 });
    const { item } = res.json<McpTokenCreated>();
    await recordWriteCall(test.deps.db, {
      userId: admin.id,
      tokenId: item.id,
      tool: 'create_task',
      targetId: 'task-1',
      status: 201,
    });
    const mine = await call('GET', '/api/me/mcp/audit', admin.cookie);
    expect(mine.json()).toEqual([
      expect.objectContaining({
        tool: 'create_task',
        targetId: 'task-1',
        ok: true,
        status: 201,
        tokenName: 'Writer',
      }),
    ]);
    const theirs = await call('GET', '/api/me/mcp/audit', other.cookie);
    expect(theirs.json()).toEqual([]);
  });

  it('answers 409 at the token limit', async () => {
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email, name: 'Lim' });
    admins.push(row.id);
    const cookie = await loginAs(test.app, email);
    for (let i = 0; i < 10; i += 1) expect((await create(cookie)).statusCode).toBe(201);
    const res = await create(cookie);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'mcp_token_limit' });
  });
});
