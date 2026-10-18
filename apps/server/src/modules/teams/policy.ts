import type { SessionUser } from '@spolu/shared';
import { isAdmin } from '../users/policy.js';

// Teams T1 (spec "Permissions"). The item rules (read, edit) stay the knowledge module's: the
// teams routes reach a meeting only through `meetingForTeamsAction`, and these add the rest.

/**
 * Whether the actor sees anything of Teams at all: an admin (superadmin included), and the
 * integration is configured. Everyone else gets 404 from every Teams route: the feature is
 * invisible to clients and ziadatels, and to everyone while it is not set up.
 */
export function canUseTeams(actor: SessionUser, configured: boolean): boolean {
  return configured && isAdmin(actor);
}

/**
 * Creating a Teams meeting for a meeting item, or connecting a pasted link to it: an admin who
 * may edit the item (every admin may), when it has no Teams meeting yet. Connecting is always
 * this explicit admin action, never a side effect of saving the meeting's link: the transcript
 * is fetched with the app's power, so a client must not be able to pull another one's call.
 */
export function canLinkTeamsMeeting(
  actor: SessionUser,
  context: { configured: boolean; canEditItem: boolean; linked: boolean },
): boolean {
  return canUseTeams(actor, context.configured) && context.canEditItem && !context.linked;
}

/**
 * Recurring calls (ADR 0049): "also for the following calls" of a create, and "Stop for the
 * following calls": admins who edit a call of a series, while Teams is configured.
 */
export function canPlanTeamsSeries(
  actor: SessionUser,
  context: { configured: boolean; canEditItem: boolean; inSeries: boolean },
): boolean {
  return canUseTeams(actor, context.configured) && context.canEditItem && context.inSeries;
}

/** "Check now", "Replace with the Teams transcript" and "Disconnect": admins who edit it. */
export function canManageTeamsLink(
  actor: SessionUser,
  context: { configured: boolean; canEditItem: boolean; linked: boolean },
): boolean {
  return canUseTeams(actor, context.configured) && context.canEditItem && context.linked;
}
