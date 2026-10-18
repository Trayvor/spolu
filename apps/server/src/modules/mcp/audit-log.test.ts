import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { McpTokenCreated } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { mcpTokens } from './schema.js';
import { eq } from 'drizzle-orm';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('MCP tokens: audit rows', () => {
  let test: TestApp;
  let admin: { id: string; cookie: string };
  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email, name: 'Jana' });
    admin = { id: row.id, cookie: await loginAs(test.app, email) };
  });
  afterAll(async () => {
    await deactivateUser(test.deps.db, admin.id);
    await test.app.close();
    await test.close();
  });

  it('creating a token records mcp_token.created without the token value; revoking records revoked', async () => {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/me/mcp/tokens',
      headers: { cookie: admin.cookie },
      payload: { name: 'Claude Desktop', scope: 'write', expiresInDays: 30 },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json<McpTokenCreated>();
    const [stored] = await test.deps.db
      .select()
      .from(mcpTokens)
      .where(eq(mcpTokens.id, created.item.id));
    const rows = await auditRowsOf(test.deps.db, created.item.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'mcp_token',
      action: 'created',
      entityLabel: 'Claude Desktop',
      actorUserId: admin.id,
      changes: {
        name: { to: 'Claude Desktop' },
        scope: { to: 'write' },
        expiresAt: { to: created.item.expiresAt },
      },
    });
    const text = JSON.stringify(rows);
    expect(text).not.toContain(created.token);
    expect(text).not.toContain(stored!.tokenHash);

    const revoke = () =>
      test.app.inject({
        method: 'DELETE',
        url: `/api/me/mcp/tokens/${created.item.id}`,
        headers: { cookie: admin.cookie },
      });
    expect((await revoke()).statusCode).toBe(204);
    expect((await revoke()).statusCode).toBe(404);
    expect((await auditRowsOf(test.deps.db, created.item.id)).map((r) => r.action)).toEqual([
      'created',
      'revoked',
    ]);
  });
});
