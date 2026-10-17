import type { SessionUser } from '@spolu/shared';
import { canReadGroup } from '../groups/policy.js';

/** A channel is readable by whoever can read its group (a task chat belongs to the task's group). */
export function canReadChannel(
  actor: SessionUser,
  channel: { groupId: string },
  actorGroupIds: readonly string[],
): boolean {
  return canReadGroup(actor, channel.groupId, actorGroupIds);
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

/**
 * Phase 28: whoever reads the channel (the caller checked that) reacts to any live message, their
 * own too; a deleted message takes no reactions.
 */
export function canReact(message: { deletedAt: Date | null }): boolean {
  return message.deletedAt === null;
}

/** Whether the actor wrote the message (deleted or not); decides 403 versus a quiet no-op. */
export function isMessageAuthor(actor: SessionUser, message: { authorId: string }): boolean {
  return message.authorId === actor.id;
}
