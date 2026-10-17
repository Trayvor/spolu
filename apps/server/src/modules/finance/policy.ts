import type { Role, SessionUser, TimeEntrySource } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/**
 * Finance permissions (Phase 32, spec §2.2). Pure functions; every finance route, the `finance`
 * room and every finance notification ask `canSeeFinance`.
 */

/**
 * A finance admin: the superadmin always (owner decision 1), an admin with the right. A client
 * never, whatever the session says.
 */
export function canSeeFinance(actor: SessionUser): boolean {
  if (actor.role === 'superadmin') return true;
  return actor.role === 'admin' && actor.finance;
}

/** Only the superadmin grants or removes the right, and only on an active admin. */
export function canGrantFinance(
  actor: SessionUser,
  target: { id: string; role: Role; disabledAt: Date | null },
): boolean {
  return (
    actor.role === 'superadmin' &&
    target.role === 'admin' &&
    target.disabledAt === null &&
    target.id !== actor.id
  );
}

/** An admin (or the superadmin) who is an assignee of the task now logs their own time on it. */
export function canLogOwnTaskTime(actor: SessionUser, assigneeIds: readonly string[]): boolean {
  return isAdmin(actor) && assigneeIds.includes(actor.id);
}

/**
 * An admin (or the superadmin) who is a riešiteľ of the ticket now logs their own time on it
 * (2026-10-17). Also on a ticket without a client (owner decision 24): the entry has no client
 * until the ticket gets one.
 */
export function canLogOwnTicketTime(
  actor: SessionUser,
  ticket: { assigneeIds: readonly string[]; groupId: string | null },
): boolean {
  return isAdmin(actor) && ticket.assigneeIds.includes(actor.id);
}

/** A finance admin edits any entry; another admin only their own task or ticket entry. */
export function canEditTimeEntry(
  actor: SessionUser,
  entry: { source: TimeEntrySource; userId: string },
): boolean {
  if (canSeeFinance(actor)) return true;
  return isAdmin(actor) && entry.source !== 'manual' && entry.userId === actor.id;
}

export function canManageRates(actor: SessionUser): boolean {
  return canSeeFinance(actor);
}

export function canAddManualEntry(actor: SessionUser): boolean {
  return canSeeFinance(actor);
}
