import { and, eq } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { tickets } from './schema.js';

/**
 * Whether the user initiated (is the requester of) a ticket of the group. Kept apart from
 * `service.ts`, which imports the groups module, so the groups module can ask without a cycle.
 */
export async function hasInitiatedTicketIn(
  db: Db,
  userId: string,
  groupId: string,
): Promise<boolean> {
  const [row] = await db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.requesterUserId, userId), eq(tickets.groupId, groupId)))
    .limit(1);
  return row !== undefined;
}
