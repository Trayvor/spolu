import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { callTool, mcpRequest, mcpToken } from '../../../test/mcp.js';
import { createGroup, setGroupDeactivated } from '../groups/service.js';
import { addMembership } from '../groups/memberships.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { mcpAuditLog, mcpTokens } from './schema.js';
import { revokeToken } from './tokens.js';
import { capText, collectAnswers, MCP_MAX_RESPONSE_BYTES, MCP_MAX_TEXT } from './transport.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('MCP transport (POST /mcp)', () => {
  let test: TestApp;
  let adminId: string;
  let token: string;
  const admins: string[] = [];

  const newAdmin = async () => {
    const row = await addAdmin(test.deps.db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    admins.push(row.id);
    return row;
  };

  beforeAll(async () => {
    test = await buildTestApp();
    adminId = (await newAdmin()).id;
    token = await mcpToken(test.deps.db, adminId, 'write');
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('answers initialize with the protocol version, the tools capability and instructions', async () => {
    const res = await mcpRequest(test.app, token, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.headers['mcp-session-id']).toBeUndefined();
    const { result } = res.json();
    expect(result).toMatchObject({
      protocolVersion: '2025-06-18',
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'spolu', title: 'Help by eGrant' },
    });
    expect(result.instructions).toContain('permissions');
  });

  it('offers its newest version for an unknown one', async () => {
    const res = await mcpRequest(test.app, token, 'initialize', { protocolVersion: '1999-01-01' });
    expect(res.json().result.protocolVersion).toBe('2025-11-25');
  });

  it('answers ping, 202 for notifications, -32601 for an unknown method', async () => {
    expect((await mcpRequest(test.app, token, 'ping')).json()).toMatchObject({ result: {} });
    const note = await test.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', method: 'notifications/initialized' },
    });
    expect(note.statusCode).toBe(202);
    expect(note.body).toBe('');
    const unknown = await mcpRequest(test.app, token, 'resources/list');
    expect(unknown.json().error.code).toBe(-32601);
  });

  it('answers a batch, without the notifications', async () => {
    const res = await test.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: [
        { jsonrpc: '2.0', id: 1, method: 'ping' },
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { jsonrpc: '2.0', id: 2, method: 'ping' },
      ],
    });
    expect(res.json().map((r: { id: number }) => r.id)).toEqual([1, 2]);
  });

  describe('batches', () => {
    const batch = (t: string, payload: unknown, headers: Record<string, string> = {}) =>
      test.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: {
          authorization: `Bearer ${t}`,
          'content-type': 'application/json',
          ...headers,
        },
        payload: JSON.stringify(payload),
      });
    const pings = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ jsonrpc: '2.0', id: i + 1, method: 'ping' }));

    it.each(['2025-06-18', '2025-11-25'])('protocol %s refuses a batch', async (version) => {
      const res = await batch(token, pings(2), { 'mcp-protocol-version': version });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toMatchObject({ code: -32600 });
      expect(res.json().error.message).toContain('batch');
    });

    it('protocol 2025-03-26 (or no header) answers a batch of at most 10', async () => {
      const old = await batch(token, pings(10), { 'mcp-protocol-version': '2025-03-26' });
      expect(old.statusCode).toBe(200);
      expect(old.json()).toHaveLength(10);
      const tooMany = await batch(token, pings(11));
      expect(tooMany.statusCode).toBe(400);
      expect(tooMany.json().error).toMatchObject({ code: -32600 });
      expect(tooMany.json().error.message).toContain('10');
    });

    it('each message of a batch counts against the rate limit', async () => {
      const admin = await newAdmin();
      const t = await mcpToken(test.deps.db, admin.id, 'read');
      // 12 batches of 10 = the 120 requests of the minute; the next single message is refused.
      for (let i = 0; i < 12; i += 1) expect((await batch(t, pings(10))).statusCode).toBe(200);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(429);
    });
  });

  describe('answer size', () => {
    const answer = (id: number, size: number) => ({
      jsonrpc: '2.0' as const,
      id,
      result: { text: 'x'.repeat(size) },
    });

    it('keeps answers under the cap and refuses the rest with a clear error', async () => {
      const ran: number[] = [];
      const answers = await collectAnswers(
        [1, 2, 3, 4].map((id) => ({ jsonrpc: '2.0', id, method: 'ping' })),
        async (message) => {
          const id = (message as { id: number }).id;
          ran.push(id);
          return answer(id, 400);
        },
        1000,
      );
      // 1 and 2 fit; 3 ran but its answer crosses the cap; 4 is not run.
      expect(ran).toEqual([1, 2, 3]);
      expect(answers.map((a) => a.id)).toEqual([1, 2, 3, 4]);
      expect(answers[0]).toHaveProperty('result');
      expect(answers[1]).toHaveProperty('result');
      expect(answers[2]).toMatchObject({ error: { code: -32603 } });
      expect((answers[2] as { error: { message: string } }).error.message).toContain('too large');
      expect(answers[3]).toMatchObject({ error: { code: -32603 } });
      expect((answers[3] as { error: { message: string } }).error.message).toContain('not run');
    });

    it('the cap is 5 MB', () => {
      expect(MCP_MAX_RESPONSE_BYTES).toBe(5 * 1024 * 1024);
    });
  });

  it('answers a parse error and an invalid request', async () => {
    const bad = await test.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: '{not json',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe(-32700);
    const invalid = await test.app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: { id: 1, method: 'ping' },
    });
    expect(invalid.json().error.code).toBe(-32600);
  });

  it('GET and DELETE answer 405 (no stream, no sessions)', async () => {
    for (const method of ['GET', 'DELETE'] as const) {
      const res = await test.app.inject({ method, url: '/mcp' });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe('POST');
    }
  });

  it('refuses a foreign Origin and an unsupported protocol header', async () => {
    const foreign = await mcpRequest(test.app, token, 'ping', undefined, {
      origin: 'https://evil.example',
    });
    expect(foreign.statusCode).toBe(403);
    const ours = await mcpRequest(test.app, token, 'ping', undefined, {
      origin: new URL(test.deps.config.publicUrl).origin,
    });
    expect(ours.statusCode).toBe(200);
    const old = await mcpRequest(test.app, token, 'ping', undefined, {
      'mcp-protocol-version': '2024-11-05',
    });
    expect(old.statusCode).toBe(400);
    const current = await mcpRequest(test.app, token, 'ping', undefined, {
      'mcp-protocol-version': '2025-06-18',
    });
    expect(current.statusCode).toBe(200);
  });

  describe('authentication', () => {
    it.each([
      ['no token', null],
      ['a wrong token', 'spolu_mcp_wrong'],
      ['a session-less garbage header', 'garbage'],
    ])('%s answers 401 with WWW-Authenticate', async (_name, value) => {
      const res = await mcpRequest(test.app, value, 'ping');
      expect(res.statusCode).toBe(401);
      expect(res.headers['www-authenticate']).toContain('Bearer');
    });

    it('a revoked token answers 401', async () => {
      const admin = await newAdmin();
      const t = await mcpToken(test.deps.db, admin.id);
      const [row] = await test.deps.db
        .select({ id: mcpTokens.id })
        .from(mcpTokens)
        .where(eq(mcpTokens.userId, admin.id));
      await revokeToken(test.deps.db, admin.id, row!.id);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(401);
    });

    it('an expired token answers 401', async () => {
      const admin = await newAdmin();
      const t = await mcpToken(test.deps.db, admin.id);
      await test.deps.db
        .update(mcpTokens)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(mcpTokens.userId, admin.id));
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(401);
    });

    it('a disabled user’s token answers 401', async () => {
      const admin = await newAdmin();
      const t = await mcpToken(test.deps.db, admin.id);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(200);
      await deactivateUser(test.deps.db, admin.id);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(401);
    });

    it('a žiadateľ’s token (made outside the routes) answers 403', async () => {
      const group = await createGroup(test.deps.db, {
        name: 'Firma',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
      const person = await createUnverifiedClient(test.deps.db, `${randomUUID()}@example.com`);
      await addMembership(test.deps.db, person.id, group.id, 'ziadatel');
      const t = await mcpToken(test.deps.db, person.id);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(403);
    });

    it('a manager’s token works while they manage a live client (ADR 0071)', async () => {
      const group = await createGroup(test.deps.db, {
        name: 'Firma',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
      const person = await createUnverifiedClient(test.deps.db, `${randomUUID()}@example.com`);
      await addMembership(test.deps.db, person.id, group.id, 'client');
      const t = await mcpToken(test.deps.db, person.id);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(200);
      // Their only client deactivated: no longer a manager, refused at once.
      await setGroupDeactivated(test.deps.db, group.id, true);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(403);
      await setGroupDeactivated(test.deps.db, group.id, false);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(200);
      // The account disabled (the last membership removed): every token revoked.
      await deactivateUser(test.deps.db, person.id);
      expect((await mcpRequest(test.app, t, 'ping')).statusCode).toBe(401);
    });

    it('the session cookie is no credential for /mcp', async () => {
      const res = await test.app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { cookie: 'better-auth.session_token=x', 'content-type': 'application/json' },
        payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('tools', () => {
    it('lists every tool with a JSON Schema of its arguments', async () => {
      const res = await mcpRequest(test.app, token, 'tools/list');
      const { tools } = res.json().result as {
        tools: Array<{ name: string; inputSchema: { type: string }; annotations: object }>;
      };
      expect(tools.length).toBeGreaterThan(40);
      for (const tool of tools) {
        expect(tool.inputSchema.type, tool.name).toBe('object');
        expect(tool.inputSchema).not.toHaveProperty('$schema');
      }
      const names = tools.map((t) => t.name);
      expect(names).toContain('create_task');
      // A plain admin holds no finance right: no finance tools listed.
      expect(names.filter((n) => n.includes('finance'))).toEqual([]);
      expect(names.some((n) => n.startsWith('delete'))).toBe(false);
    });

    it('a read-only token lists no write tools', async () => {
      const t = await mcpToken(test.deps.db, adminId, 'read');
      const { tools } = (await mcpRequest(test.app, t, 'tools/list')).json().result as {
        tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }>;
      };
      expect(tools.every((tool) => tool.annotations.readOnlyHint)).toBe(true);
      expect(tools.map((tool) => tool.name)).not.toContain('create_task');
    });

    it('an unknown tool is a JSON-RPC error; bad arguments a tool error', async () => {
      const unknown = await mcpRequest(test.app, token, 'tools/call', { name: 'drop_tables' });
      expect(unknown.json().error.code).toBe(-32602);
      const bad = await callTool(test.app, token, 'get_task', { taskId: '../../etc' });
      expect(bad.isError).toBe(true);
      expect(bad.json).toMatchObject({ status: 400, error: 'validation_failed' });
    });

    it('a read-only token cannot write: refused, audited, nothing changes', async () => {
      const admin = await newAdmin();
      const readOnly = await mcpToken(test.deps.db, admin.id, 'read');
      const group = await createGroup(test.deps.db, {
        name: 'Firma',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
      const res = await callTool(test.app, readOnly, 'create_task', {
        groupId: group.id,
        task: { title: 'Nope' },
      });
      expect(res.isError).toBe(true);
      expect(res.json).toMatchObject({
        status: 403,
        error: 'forbidden',
        detail: 'read-only token',
      });
      const board = await callTool(test.app, readOnly, 'get_board', { groupId: group.id });
      expect((board.json as { tasks: unknown[] }).tasks).toEqual([]);
      const audit = await test.deps.db
        .select()
        .from(mcpAuditLog)
        .where(eq(mcpAuditLog.userId, admin.id));
      expect(audit).toEqual([
        expect.objectContaining({ tool: 'create_task', status: 403, ok: false, targetId: null }),
      ]);
    });

    it('rate-limits a token', async () => {
      const admin = await newAdmin();
      const t = await mcpToken(test.deps.db, admin.id, 'read');
      let last = 200;
      for (let i = 0; i < 125 && last === 200; i += 1) {
        last = (await mcpRequest(test.app, t, 'ping')).statusCode;
      }
      expect(last).toBe(429);
    });

    it('rate-limits a user across all their tokens', async () => {
      const admin = await newAdmin();
      const first = await mcpToken(test.deps.db, admin.id, 'read');
      const second = await mcpToken(test.deps.db, admin.id, 'read');
      for (let i = 0; i < 120; i += 1) {
        expect((await mcpRequest(test.app, first, 'ping')).statusCode).toBe(200);
      }
      expect((await mcpRequest(test.app, second, 'ping')).statusCode).toBe(429);
    });

    it('an address over the failed-sign-in limit is refused before the token lookup', async () => {
      const admin = await newAdmin();
      const good = await mcpToken(test.deps.db, admin.id, 'read');
      const from = (t: string) =>
        test.app.inject({
          method: 'POST',
          url: '/mcp',
          remoteAddress: '203.0.113.77',
          headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' },
          payload: { jsonrpc: '2.0', id: 1, method: 'ping' },
        });
      for (let i = 0; i < 30; i += 1) expect((await from('spolu_mcp_wrong')).statusCode).toBe(401);
      expect((await from('spolu_mcp_wrong')).statusCode).toBe(429);
      // Even a good token from that address waits out the window: no lookup is made.
      expect((await from(good)).statusCode).toBe(429);
      expect((await mcpRequest(test.app, good, 'ping')).statusCode).toBe(200);
    });
  });

  it('cuts a long answer and says so', () => {
    const text = capText('x'.repeat(MCP_MAX_TEXT + 10));
    expect(text.length).toBeLessThan(MCP_MAX_TEXT + 200);
    expect(text).toContain('[cut:');
    expect(capText('short')).toBe('short');
  });
});
