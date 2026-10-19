import type { SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

/**
 * Who has a personal calendar feed (ADR 0051): admins and the superadmin, and a client with at
 * least one active client membership (`actorGroupIds` from `clientGroupIds`). A žiadateľ only
 * reads no group, so has no feed. Guards the `/me/calendar-feed` routes; what the feed shows is
 * decided again at every fetch by the modules' own read rules.
 */
export function canUseCalendarFeed(actor: SessionUser, actorGroupIds: readonly string[]): boolean {
  return isAdmin(actor) || (actor.role === 'client' && actorGroupIds.length > 0);
}
