import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { callTool, mcpToken } from '../../../test/mcp.js';
import { ANNOUNCEMENTS } from '../announcements/catalogue.js';
import { addAdmin, deactivateUser } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const CURRENT = ANNOUNCEMENTS[0]!.id;

describe('MCP "What\'s new" tools', () => {
  let test: TestApp;
  let adminId: string;
  let token: string;
  let readToken: string;
  beforeAll(async () => {
    test = await buildTestApp();
    const a = await addAdmin(test.deps.db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
    adminId = a.id;
    token = await mcpToken(test.deps.db, a.id);
    readToken = await mcpToken(test.deps.db, a.id, 'read');
  });
  afterAll(async () => {
    await deactivateUser(test.deps.db, adminId);
    await test.app.close();
    await test.close();
  });

  it('reads the current announcement, marks it seen, then reads none', async () => {
    const first = await callTool(test.app, readToken, 'get_announcement');
    expect(first.isError).toBe(false);
    // No AI on this server, no finance right: saved replies and bulk email only.
    expect(first.json).toEqual({
      announcement: { id: CURRENT, sections: ['snippets', 'bulkEmail'] },
    });

    const refused = await callTool(test.app, readToken, 'mark_announcement_seen', {
      announcementId: CURRENT,
    });
    expect(refused.json).toMatchObject({ status: 403, detail: 'read-only token' });

    const marked = await callTool(test.app, token, 'mark_announcement_seen', {
      announcementId: CURRENT,
    });
    expect(marked.isError).toBe(false);
    expect((await callTool(test.app, token, 'get_announcement')).json).toEqual({
      announcement: null,
    });
    const unknown = await callTool(test.app, token, 'mark_announcement_seen', {
      announcementId: 'nope',
    });
    expect(unknown.json).toMatchObject({ status: 404 });
  });
});
