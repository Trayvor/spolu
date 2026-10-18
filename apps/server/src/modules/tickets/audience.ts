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

/**
 * Who hears that a ticket was resolved (2026-10-18): its audience (`ticketAudienceIds`) and also
 * the people who watch its client's tickets while it has riešitelia, so a client who followed
 * the ticket hears the outcome. A ticket without a client adds nobody (its watchers are every
 * admin only while it has no riešiteľ). Only people who can still read the ticket.
 */
export async function ticketResolvedAudienceIds(db: Db, ticket: TicketRow): Promise<string[]> {
  const audience = await ticketAudienceIds(db, ticket);
  if (ticket.groupId === null) return audience;
  const watchers = await ticketWatcherIds(db, ticket.groupId);
  const more = watchers.filter((id) => !audience.includes(id));
  return more.length === 0 ? audience : [...audience, ...(await readingIds(db, ticket, more))];
}
