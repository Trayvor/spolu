import { eq, lt } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { session, verification } from './schema.js';

/**
 * Logs the user out everywhere. Deleting the rows is enough: sessions live only in the
 * database (no cookie cache, no secondary storage), so the old cookies stop working at once.
 */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}

/**
 * Deletes the sessions that expired before `before` (2026-10-18, the daily auth cleanup;
 * `session_expires_at_idx`): a login lasts 30 days and nothing else removes the row. Returns how
 * many.
 */
export async function deleteExpiredSessions(db: Db, before = new Date()): Promise<number> {
  const deleted = await db
    .delete(session)
    .where(lt(session.expiresAt, before))
    .returning({ id: session.id });
  return deleted.length;
}

/** Deletes login codes (and other verification rows) that expired before `before`; returns how many. */
export async function deleteExpiredVerifications(db: Db, before = new Date()): Promise<number> {
  const deleted = await db
    .delete(verification)
    .where(lt(verification.expiresAt, before))
    .returning({ id: verification.id });
  return deleted.length;
}
