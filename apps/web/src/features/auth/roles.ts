import type { SessionUser } from '@spolu/shared';

/**
 * Cosmetic only: decides whether to show admin links. The server enforces the real
 * permissions (`modules/users/policy.ts`) on every request.
 */
export function isAdmin(user: SessionUser | null): boolean {
  return user !== null && user.role !== 'client';
}

/**
 * Where the "Admins" link goes. The route itself arrives with the admins screen (Task 9);
 * until then the cast keeps the typed router happy. Remove the cast when the route exists.
 */
export const ADMINS_PATH = '/admins' as '/';
