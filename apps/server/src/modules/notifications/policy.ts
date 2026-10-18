import type { MemberRole, NotificationCategory, SessionUser } from '@spolu/shared';
import { canSeeFinance } from '../finance/policy.js';
import { isAdmin } from '../users/policy.js';

/**
 * Whether the notification centre shows one of the person's own events now (UX review F2). The
 * event was meant for them, but access may have changed since: a finance item needs the finance
 * right today, and for a non-admin the group's membership today (`roles`: their active roles by
 * group). A requester (`ziadatel`) membership opens only ticket items; a ticket without a client
 * was addressed to its initiator by its recorder. An unknown kind never shows.
 */
export function canSeeCentreItem(
  actor: SessionUser,
  item: { groupId: string | null; category: NotificationCategory | null },
  roles: ReadonlyMap<string, MemberRole>,
): boolean {
  if (item.category === null) return false;
  if (item.category === 'finance') return canSeeFinance(actor);
  if (isAdmin(actor)) return true;
  if (item.groupId === null) return item.category === 'tickets';
  const role = roles.get(item.groupId);
  if (item.category === 'tickets') return role !== undefined;
  return role === 'client';
}
