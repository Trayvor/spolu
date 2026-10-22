import type { SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { clientGroupIds } from '../groups/memberships.js';
import { isAdmin } from '../users/policy.js';
import { canUseMcp } from './policy.js';

/**
 * `canUseMcp` with the user's manager memberships read fresh (one indexed query, clients only):
 * a manager removed from their last client, or whose clients were all deactivated, is refused at
 * once, though their tokens stay until they expire or the account is disabled.
 */
export async function mayUseMcp(db: Db, actor: SessionUser): Promise<boolean> {
  if (isAdmin(actor)) return true;
  if (actor.role !== 'client') return false;
  return canUseMcp(actor, (await clientGroupIds(db, actor.id)).length);
}
