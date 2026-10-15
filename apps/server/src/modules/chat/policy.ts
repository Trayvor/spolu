import type { SessionUser } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';

/** A channel is readable by whoever can read its group (a task chat belongs to the task's group). */
export function canReadChannel(
  actor: SessionUser,
  channel: { groupId: string },
  actorGroupId: string | null,
): boolean {
  return canReadGroup(actor, channel.groupId, actorGroupId);
}

/** Only the author edits a message, and never a deleted one. */
export function canEditMessage(
  actor: SessionUser,
  message: { authorId: string; deletedAt: Date | null },
): boolean {
  return message.authorId === actor.id && message.deletedAt === null;
}

/** Same rule as editing: the author, while the message is not deleted. */
export function canDeleteMessage(
  actor: SessionUser,
  message: { authorId: string; deletedAt: Date | null },
): boolean {
  return canEditMessage(actor, message);
}
