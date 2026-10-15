import type { SessionUser } from '@spolu/shared';

/**
 * Cosmetic only: decides whether to show admin links. The server enforces the real
 * permissions (`modules/users/policy.ts`) on every request.
 */
export function isAdmin(user: SessionUser | null): boolean {
  return user !== null && user.role !== 'client';
}
