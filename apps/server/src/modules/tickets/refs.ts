import { and, eq, inArray } from 'drizzle-orm';
import type { SourceTicket } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { tickets } from './schema.js';

/**
 * The short form of a ticket other modules show (the task panel's "Ticket: #123 subject" line).
 * Only a ticket of `groupId` answers: whoever reads a task of that group reads every ticket of it
 * (admins and the group's clients), so the line never names a ticket the reader may not open.
 * Kept apart from `service.ts` so the tasks module can import it without an import cycle.
 */
export async function getTicketRef(
  db: Db,
  ticketId: string,
  groupId: string,
): Promise<SourceTicket | null> {
  const [row] = await db
    .select({ id: tickets.id, number: tickets.number, subject: tickets.subject })
    .from(tickets)
    .where(and(eq(tickets.id, ticketId), eq(tickets.groupId, groupId)));
  return row ?? null;
}

/**
 * Number and subject of the given tickets in one query, keyed by id (the finance work log's
 * ticket units, Phase 32). Unknown ids are absent. The caller checked who may see them (finance
 * admins only), so no group condition here.
 */
export async function getTicketRefs(
  db: Db,
  ids: string[],
): Promise<Map<string, { number: number; subject: string | null }>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: tickets.id, number: tickets.number, subject: tickets.subject })
    .from(tickets)
    .where(inArray(tickets.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, { number: r.number, subject: r.subject }]));
}
