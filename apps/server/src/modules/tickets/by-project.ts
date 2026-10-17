import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { tickets } from './schema.js';

/**
 * Open tickets (New and In progress) per project of one client, for the Prehľad projects card
 * (Phase 33 part P1): one grouped count on `tickets_group_project_event_idx`. Projects without
 * open tickets are left out of the map.
 */
export async function openTicketCountsByProject(
  db: Db,
  groupId: string,
  projectIds: string[],
): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const rows = await db
    .select({ projectId: tickets.projectId, n: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        eq(tickets.groupId, groupId),
        inArray(tickets.projectId, projectIds),
        ne(tickets.status, 'resolved'),
      ),
    )
    .groupBy(tickets.projectId);
  return new Map(rows.map((row) => [row.projectId!, row.n]));
}
