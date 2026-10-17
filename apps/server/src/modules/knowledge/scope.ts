import type { Db } from '../../infra/db/client.js';
import { withAdminGroup } from '../groups/admin-group.js';
import { managedGroupIds } from '../groups/managers.js';

/**
 * The admin's managed group ids (Phase 18 client managers) plus the admin group (Phase 34: every
 * admin is effectively its manager): the default scope of the global list. Empty when the admin
 * manages no client; the list then shows all clients, the admin group too.
 */
export async function managedGroupIdsOf(db: Db, adminId: string): Promise<string[]> {
  return withAdminGroup(db, await managedGroupIds(db, adminId));
}
