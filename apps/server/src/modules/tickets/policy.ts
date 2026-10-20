import {
  TICKET_RATING_LIMITS,
  type GroupKind,
  type MemberRole,
  type Role,
  type SessionUser,
  type TicketStatus,
} from '@spolu/shared';
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

/**
 * Whether a group can hold tickets: every client group, never the admin group (Phase 34). A ticket
 * is never created in, moved into or matched to it.
 */
export function canHoldTickets(group: { kind: GroupKind }): boolean {
  return group.kind !== 'admin';
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

/**
 * Add or remove riešitelia (assignees): admins and the group's clients; on a ticket without a
 * client admins only. A ziadatel never, not even on their own ticket.
 */
export function canAssignTicket(
  actor: SessionUser,
  ticket: TicketRef,
  role: MemberRole | null,
): boolean {
  if (isAdmin(actor)) return true;
  return ticket.groupId !== null && role === 'client';
}

/**
 * Who can be a riešiteľ: any active admin, and a client of the ticket's group (whether or not
 * they watch its tickets). `role` is the person's account role, `memberRole` their active role
 * in the ticket's group. Never a ziadatel.
 */
export function canBeTicketAssignee(
  role: Role,
  ticket: TicketRef,
  memberRole: MemberRole | null,
): boolean {
  if (role !== 'client') return true;
  return ticket.groupId !== null && memberRole === 'client';
}

/**
 * "Watch tickets" of a group: admins and its clients; a ziadatel hears only their own tickets, as
 * their initiator.
 */
export function canWatchTickets(actor: SessionUser, role: MemberRole | null): boolean {
  return isAdmin(actor) || role === 'client';
}

// ---- Ticket rating (2026-10-19) ---------------------------------------------------------------

/**
 * The ticket's initiator, not an admin, who reads it. Admins solve tickets, so an admin initiator
 * never rates. The time window is checked apart (`ratingOpen`).
 */
export function canRateTicket(
  actor: SessionUser,
  ticket: TicketRef,
  role: MemberRole | null,
): boolean {
  return (
    !isAdmin(actor) && ticket.requesterUserId === actor.id && canReadTicket(actor, ticket, role)
  );
}

const DAY_MS = 86_400_000;

/** Until when a rating of a ticket resolved at `resolvedAt` can be set or changed. */
export function ratingEditableUntil(resolvedAt: Date): Date {
  return new Date(resolvedAt.getTime() + TICKET_RATING_LIMITS.editDays * DAY_MS);
}

/** Whether the rating can be written now: the ticket is resolved and inside the window. */
export function ratingOpen(
  ticket: { status: TicketStatus; resolvedAt: Date | null },
  now: Date,
): boolean {
  return (
    ticket.status === 'resolved' &&
    ticket.resolvedAt !== null &&
    now.getTime() <= ratingEditableUntil(ticket.resolvedAt).getTime()
  );
}

/**
 * Every rating with its comment, and the totals: every admin (owner decision 2026-10-19, never
 * narrowed to the ticket's owners or the client's managers), nobody else.
 */
export function canSeeTicketRatings(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * "Navrhnúť odpoveď" (2026-10-19): an AI draft of a reply in a ticket's chat, admins only, on any
 * ticket (also one without a client). Checked before the ticket lookup, so nobody else can probe
 * ticket ids. See docs/superpowers/specs/2026-10-19-ticket-ai-draft-design.md.
 */
export function canDraftTicketReply(actor: SessionUser): boolean {
  return isAdmin(actor);
}

// ---- Automatic riešitelia by area (2026-10-21) -----------------------------------------------

/**
 * A client's area → admin table: admins only, read and write (owner decision 2026-10-21). Clients
 * never see it; the route answers them 404 before anything is read.
 */
export function canManageTicketAreas(actor: SessionUser): boolean {
  return isAdmin(actor);
}

/**
 * Who can stand in a row of the table: an active admin (`role` from `getActiveRoles`, undefined
 * for a disabled or unknown user). A client never, though a client can be a riešiteľ by hand.
 */
export function canBeAreaAssignee(role: Role | undefined): boolean {
  return role === 'admin' || role === 'superadmin';
}
