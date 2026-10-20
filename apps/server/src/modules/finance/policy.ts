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

/**
 * Expenses (Phase 32 E, decision O5): finance admins only. Every expense route sits behind
 * `requireFinance`; this names the rule where expenses are read (the overview's money out).
 */
export function canSeeExpenses(actor: SessionUser): boolean {
  return canSeeFinance(actor);
}

/** The organisation's items, folders and files (Phase 32 E, decision O6): finance admins only. */
export function canManageOrgFinance(actor: SessionUser): boolean {
  return canSeeFinance(actor);
}

/**
 * Salaries (owner decision of 2026-10-21, ADR 0065): finance admins only. An admin without the
 * right does not see even their own salary: the routes answer 404 to anyone else.
 */
export function canSeeSalaries(actor: SessionUser): boolean {
  return canSeeFinance(actor);
}

/** Who a salary may pay (decision E4): an active admin or the superadmin. */
export function canBePayee(target: { role: Role; disabledAt: Date | null }): boolean {
  return (target.role === 'admin' || target.role === 'superadmin') && target.disabledAt === null;
}

/** Where a contract of several clients is read: `/finance`, or one client's Financie tab. */
export type ShareView = { kind: 'finance' } | { kind: 'client'; groupId: string };

/**
 * The shares a view shows (decision E10): every share on `/finance`; in a client's tab only that
 * client's own, never the other clients' names or shares.
 */
export function sharesVisibleIn<T extends { groupId: string }>(
  view: ShareView,
  shares: readonly T[],
): T[] {
  return view.kind === 'finance' ? [...shares] : shares.filter((s) => s.groupId === view.groupId);
}
