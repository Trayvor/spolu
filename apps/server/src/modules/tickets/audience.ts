import { eq } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { listAdmins } from '../users/service.js';
import { ticketAssignees } from './schema.js';
import { readingIds, type TicketRow } from './service.js';
import { ticketWatcherIds } from './watch.js';

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

/** Whether the ticket has at least one riešiteľ. */
export async function hasAssignees(db: Db, ticketId: string): Promise<boolean> {
  return (await ticketAssigneeIds(db, ticketId)).length > 0;
}

/**
 * Who answers the ticket now (owner decision 2026-10-17, ADR 0021 amendment): its riešitelia once it has
 * any; without one, the people who watch its client's tickets (`watch.ts`), or every active admin
 * for a ticket without a client. Only people who can still read the ticket.
 */
export async function ticketOwnerIds(db: Db, ticket: TicketRow): Promise<string[]> {
  const assignees = await ticketAssigneeIds(db, ticket.id);
  if (assignees.length > 0) return readingIds(db, ticket, assignees);
  const ids =
    ticket.groupId === null
      ? (await listAdmins(db)).map((a) => a.id)
      : await ticketWatcherIds(db, ticket.groupId);
  return readingIds(db, ticket, ids);
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
