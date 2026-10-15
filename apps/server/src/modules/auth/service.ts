import { eq } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { session } from './schema.js';

/**
 * Logs the user out everywhere. Deleting the rows is enough: sessions live only in the
 * database (no cookie cache, no secondary storage), so the old cookies stop working at once.
 */
export async function revokeAllSessions(db: Db, userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}
