import { and, asc, eq, inArray } from 'drizzle-orm';
import type { MessageAttachedTicket } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { ticketAssignees, tickets } from './schema.js';

/** The card of a ticket that exists: `MessageAttachedTicket` with `available: true`. */
export type AttachableTicketCard = Extract<MessageAttachedTicket, { available: true }>;

const CARD_ASSIGNEES = 3;

/**
 * Phase 34: the cards of these tickets that belong to `targetGroupId` now, by id, with live fields
 * (status, riešitelia); the others (deleted, moved to another client, without one) are left out
 * and show as unavailable. Two queries for any number of ids. A channel's group readers read every
 * ticket of that group; a requester's copy is narrowed by the chat (`readableWorkTickets`).
 */
export async function attachableTicketCards(
  db: Db,
  targetGroupId: string,
  ids: string[],
): Promise<Map<string, AttachableTicketCard>> {
  const cards = new Map<string, AttachableTicketCard>();
  const unique = [...new Set(ids)];
  if (unique.length === 0) return cards;
  const rows = await db
    .select({
      id: tickets.id,
      groupId: tickets.groupId,
      number: tickets.number,
      subject: tickets.subject,
      status: tickets.status,
    })
    .from(tickets)
    .where(and(inArray(tickets.id, unique), eq(tickets.groupId, targetGroupId)));
  if (rows.length === 0) return cards;
  // Deliberate read-only exception to "no other module's tables": names joined from `user`.
  const people = await db
    .select({ ticketId: ticketAssignees.ticketId, id: user.id, name: user.name })
    .from(ticketAssignees)
    .innerJoin(user, eq(user.id, ticketAssignees.userId))
    .where(
      inArray(
        ticketAssignees.ticketId,
        rows.map((r) => r.id),
      ),
    )
    .orderBy(asc(user.name), asc(user.id));
  const assigneesOf = new Map<string, { id: string; name: string }[]>();
  for (const p of people) {
    const list = assigneesOf.get(p.ticketId) ?? [];
    if (list.length < CARD_ASSIGNEES) list.push({ id: p.id, name: p.name });
    assigneesOf.set(p.ticketId, list);
  }
  for (const row of rows) {
    cards.set(row.id, {
      id: row.id,
      available: true,
      groupId: row.groupId,
      number: row.number,
      subject: row.subject,
      status: row.status,
      assignees: assigneesOf.get(row.id) ?? [],
    });
  }
  return cards;
}
