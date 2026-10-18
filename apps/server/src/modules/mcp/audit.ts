import { randomUUID } from 'node:crypto';
import { desc, eq, lt } from 'drizzle-orm';
import { MCP_LIMITS, type McpAuditEntry } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { mcpAuditLog, mcpTokens } from './schema.js';

/** One write tool call (spec §2 #12): who, which tool, on what, the route's status. No content. */
export type AuditRecord = {
  userId: string;
  tokenId: string;
  tool: string;
  targetId: string | null;
  status: number;
};

export async function recordWriteCall(db: Db, record: AuditRecord): Promise<void> {
  await db.insert(mcpAuditLog).values({
    id: randomUUID(),
    ...record,
    // An id from the arguments is only an id: keep it short and printable.
    targetId: record.targetId === null ? null : record.targetId.slice(0, 100),
    ok: record.status >= 200 && record.status < 300,
  });
}

/** The user's own last write calls, newest first, with each token's name (one indexed query). */
export async function listAudit(db: Db, userId: string): Promise<McpAuditEntry[]> {
  const rows = await db
    .select({
      id: mcpAuditLog.id,
      tool: mcpAuditLog.tool,
      targetId: mcpAuditLog.targetId,
      ok: mcpAuditLog.ok,
      status: mcpAuditLog.status,
      createdAt: mcpAuditLog.createdAt,
      tokenName: mcpTokens.name,
    })
    .from(mcpAuditLog)
    .leftJoin(mcpTokens, eq(mcpTokens.id, mcpAuditLog.tokenId))
    .where(eq(mcpAuditLog.userId, userId))
    .orderBy(desc(mcpAuditLog.createdAt))
    .limit(MCP_LIMITS.auditPage);
  return rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
}

/** How long a write call stays in the audit log; the daily job deletes older rows. */
export const AUDIT_RETENTION_DAYS = 180;

/**
 * Deletes the audit rows older than `AUDIT_RETENTION_DAYS` before `now`; the number deleted. Once
 * a day on a small table (at most 30 write calls a minute per user), so no index on `created_at`
 * alone.
 */
export async function deleteOldAudit(db: Db, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000);
  const deleted = await db
    .delete(mcpAuditLog)
    .where(lt(mcpAuditLog.createdAt, cutoff))
    .returning({ id: mcpAuditLog.id });
  return deleted.length;
}
