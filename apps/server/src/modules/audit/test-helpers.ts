import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { auditLog } from './schema.js';

/** The audit rows of one record, oldest first (tests assert rows by the record they made). */
export async function auditRowsOf(db: Db, entityId: string) {
  const rows = await db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || 0);
}

/** The audit rows of several records. */
export async function auditRowsOfMany(db: Db, entityIds: string[]) {
  if (entityIds.length === 0) return [];
  return db.select().from(auditLog).where(inArray(auditLog.entityId, entityIds));
}

/** The SQLSTATE of a Postgres error (drizzle may wrap it in `cause`). */
export function pgCode(error: unknown): unknown {
  const e = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return e?.code ?? e?.cause?.code;
}
