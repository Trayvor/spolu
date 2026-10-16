import { and, eq } from 'drizzle-orm';
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
