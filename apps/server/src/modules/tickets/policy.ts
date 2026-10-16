import type { MemberRole, SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/** What the policy needs of a ticket. */
export type TicketRef = { groupId: string | null; requesterUserId: string | null };

/**
 * Admins read every ticket, also one without a client. In the ticket's group a client reads
 * every ticket, a ziadatel only the tickets they started. `role` is the actor's active role in
 * the ticket's group (`getMembership`), null when they have none.
 */
export function canReadTicket(
  actor: SessionUser,
  ticket: TicketRef,
  role: MemberRole | null,
): boolean {
  if (isAdmin(actor)) return true;
  if (ticket.groupId === null) return false;
  if (role === 'client') return true;
  return role === 'ziadatel' && ticket.requesterUserId === actor.id;
}

/** Admins create a ticket for any client; a client in their own group; a ziadatel never. */
export function canCreateTicket(actor: SessionUser, role: MemberRole | null): boolean {
  return isAdmin(actor) || role === 'client';
}

/** Status, fields and the client of a ticket: admins only. */
export function canEditTicket(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/** Turn a ticket into tasks: admins and the group's clients, never a ticket without a client. */
export function canSplitTicket(
  actor: SessionUser,
  ticket: TicketRef,
  role: MemberRole | null,
): boolean {
  return ticket.groupId !== null && (isAdmin(actor) || role === 'client');
}
