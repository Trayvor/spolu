import type { AnnouncementSectionId, SessionUser } from '@spolu/shared';
import { canUseBulkEmail } from '../bulk-email/policy.js';
import { canSeeFinance } from '../finance/policy.js';
import { canUseSnippets } from '../snippets/policy.js';
import { canUseBoard } from '../tasks/policy.js';
import { isAdmin } from '../users/policy.js';

/** What deciding the sections needs to know about the person (and the server). */
export type AnnouncementAudience = {
  actor: SessionUser;
  /** The groups they are a client of (`clientGroupIds`); `[]` for an admin. */
  clientGroupIds: readonly string[];
  /** The server has the AI task split on (`deps.ai`). */
  taskSplitOn: boolean;
};

/**
 * "What's new" shows a section only to whoever can use its feature, by the feature's own policy:
 * the task generation needs a board (`canUseBoard` on some group) and the AI on; saved replies,
 * bulk email and finance their modules' rules. The ticket rework of 2026-11-05: confirming a
 * ticket for the admins and the clients of a group, who read every ticket there; the assignment
 * for admins, who are assigned. A žiadateľ gets the confirmation card on the ticket itself.
 */
export function canSeeAnnouncementSection(
  section: AnnouncementSectionId,
  { actor, clientGroupIds, taskSplitOn }: AnnouncementAudience,
): boolean {
  switch (section) {
    case 'taskSplit':
      // An admin uses every board (the global one too); a client the boards of their groups.
      if (!taskSplitOn) return false;
      return isAdmin(actor) || clientGroupIds.some((id) => canUseBoard(actor, id, clientGroupIds));
    case 'snippets':
      return canUseSnippets(actor);
    case 'bulkEmail':
      return canUseBulkEmail(actor);
    case 'finance':
      return canSeeFinance(actor);
    case 'ticketConfirmation':
      return isAdmin(actor) || clientGroupIds.length > 0;
    case 'ticketAssignment':
      return isAdmin(actor);
  }
}
