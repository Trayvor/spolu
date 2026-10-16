import type { Me, MeGroup, SessionUser } from '@spolu/shared';

/**
 * Cosmetic only: decides whether to show admin links. The server enforces the real
 * permissions (`modules/users/policy.ts`) on every request.
 */
export function isAdmin(user: SessionUser | null): boolean {
  return user !== null && user.role !== 'client';
}

/** The groups the person reads as a client (not the ones where they are only a requester). */
export function clientGroups(me: Me): MeGroup[] {
  return me.groups.filter((g) => g.role === 'client');
}

/** Whether the person reports tickets somewhere: an active requester (`ziadatel`) membership. */
export function isRequester(me: Me): boolean {
  return me.groups.some((g) => g.role === 'ziadatel');
}
