import type { Db } from '../../infra/db/client.js';

/** The admin's managed group ids, or null while client managers do not exist (Phase 18). */
export async function managedGroupIdsOf(db: Db, adminId: string): Promise<string[] | null> {
  // Whichever of Phases 17 and 18 merges second makes this `return managedGroupIds(db, adminId)`.
  void db;
  void adminId;
  return null;
}
