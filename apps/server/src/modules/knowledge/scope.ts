import type { Db } from '../../infra/db/client.js';
import { managedGroupIds } from '../groups/managers.js';

/**
 * The admin's managed group ids (Phase 18 client managers): the default scope of the global
 * list. Empty when the admin manages no client; the list then shows all clients.
 */
export async function managedGroupIdsOf(db: Db, adminId: string): Promise<string[]> {
  return managedGroupIds(db, adminId);
}
