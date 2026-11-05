import { eq } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { listAdmins } from '../users/service.js';
import { ticketAssignees } from './schema.js';
import { readingIds, type TicketRow } from './service.js';

/**
 * The ticket's riešitelia (`ticket_assignees`), whoever they are; the finance time hooks (Phase
 * 32) ask the active admins among them for their time on resolve.
 */
export async function ticketAssigneeIds(db: Db, ticketId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: ticketAssignees.userId })
    .from(ticketAssignees)
    .where(eq(ticketAssignees.ticketId, ticketId));
  return rows.map((r) => r.userId);
}

/**
 * Who answers the ticket now (ADR 0021 amendment, simplified 2026-11-04): its riešitelia who can
 * still read it; when none can (no riešiteľ, or the only one was deactivated), every active admin,
 * so a ticket never goes dark.
 */
export async function ticketOwnerIds(db: Db, ticket: TicketRow): Promise<string[]> {
  const owners = await readingIds(db, ticket, await ticketAssigneeIds(db, ticket.id));
  if (owners.length > 0) return owners;
  return readingIds(
    db,
    ticket,
    (await listAdmins(db)).map((a) => a.id),
  );
}

/**
 * Who hears a ticket's updates (its chat messages, status and field changes, turning into
 * tasks) and whom `@all` in its chat reaches: the ticket's owners (`ticketOwnerIds`) and its
 * initiator while they can read it, so a requester always hears the answer. The caller drops the
 * person who made the change.
 */
export async function ticketAudienceIds(db: Db, ticket: TicketRow): Promise<string[]> {
  const owners = await ticketOwnerIds(db, ticket);
  const initiator = ticket.requesterUserId;
  if (initiator === null || owners.includes(initiator)) return owners;
  return [...owners, ...(await readingIds(db, ticket, [initiator]))];
}
