import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../../infra/db/client.js';
import { testConfig } from '../../../test/test-config.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { AUDIT_RETENTION_DAYS, deleteOldAudit, recordWriteCall } from './audit.js';
import { MCP_AUDIT_CLEANUP_JOB, mcpJobHandlers } from './jobs.js';
import { mcpAuditLog } from './schema.js';
import { createToken } from './tokens.js';

const DAY_MS = 86_400_000;

describe('MCP audit retention', () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: string;
  let tokenId: string;

  beforeAll(async () => {
    ({ db, close } = createDb(testConfig().databaseUrl));
    userId = (await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Old' })).id;
    tokenId = (await createToken(db, userId, { name: 'old', scope: 'write', expiresInDays: 7 }))
      .item.id;
  });
  afterAll(async () => {
    await deactivateUser(db, userId);
    await close();
  });

  const rowAged = async (days: number) => {
    await recordWriteCall(db, {
      userId,
      tokenId,
      tool: `t${days}`,
      targetId: null,
      status: 201,
    });
    await db
      .update(mcpAuditLog)
      .set({ createdAt: new Date(Date.now() - days * DAY_MS) })
      .where(eq(mcpAuditLog.tool, `t${days}`));
  };

  it('keeps 180 days', () => {
    expect(AUDIT_RETENTION_DAYS).toBe(180);
  });

  it('the daily job deletes rows older than 180 days and keeps the rest', async () => {
    await rowAged(181);
    await rowAged(179);
    await rowAged(0);
    await mcpJobHandlers(db)[MCP_AUDIT_CLEANUP_JOB]!({});
    const left = await db
      .select({ tool: mcpAuditLog.tool })
      .from(mcpAuditLog)
      .where(eq(mcpAuditLog.userId, userId));
    expect(left.map((r) => r.tool).sort()).toEqual(['t0', 't179']);
    // A second run finds nothing more to delete.
    expect(await deleteOldAudit(db, new Date())).toBe(0);
  });
});
