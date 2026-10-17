import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  MESSAGE_MAX_EMOJI,
  type MessageReactions,
  type Reaction,
  type ReactionPeople,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { messageReactions, messages } from './schema.js';
import { nextSeq, type ChannelRow } from './service.js';

/** A new emoji would pass `MESSAGE_MAX_EMOJI` on the message (route: 400 validation_failed). */
export class TooManyEmojiError extends Error {
  constructor() {
    super('The message already has the most different emoji');
    this.name = 'TooManyEmojiError';
  }
}

/** Rolls a reaction write back when it would change nothing. */
class NoChange extends Error {}

/** The message is deleted (or was deleted since the caller read it). */
class Gone extends Error {}

/**
 * Groups reaction rows (ordered by message, then time) into each message's reactions: emoji in
 * the order they were first used, people in the order they added it.
 */
function group(rows: { messageId: string; emoji: string; userId: string }[]) {
  const byMessage = new Map<string, Reaction[]>();
  for (const row of rows) {
    const list = byMessage.get(row.messageId) ?? [];
    const reaction = list.find((r) => r.emoji === row.emoji);
    if (reaction) reaction.userIds.push(row.userId);
    else list.push({ emoji: row.emoji, userIds: [row.userId] });
    byMessage.set(row.messageId, list);
  }
  return byMessage;
}

const reactionOrder = [
  asc(messageReactions.messageId),
  asc(messageReactions.createdAt),
  asc(messageReactions.userId),
  asc(messageReactions.emoji),
];

/** The reactions of these messages, by message id: one query for any number of messages. */
export async function loadReactions(
  db: Db,
  messageIds: string[],
): Promise<Map<string, Reaction[]>> {
  if (messageIds.length === 0) return new Map();
  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
    })
    .from(messageReactions)
    .where(inArray(messageReactions.messageId, messageIds))
    .orderBy(...reactionOrder);
  return group(rows);
}

/**
 * Turns the actor's reaction with `emoji` on or off, in one transaction under the channel lock
 * (`nextSeq`): the message's `change_seq` moves, so catch-up replays it. A write that changes
 * nothing is rolled back and answers the current state with `changed: false`. A deleted message
 * (also one deleted since the caller read it) answers null; a new emoji past
 * `MESSAGE_MAX_EMOJI` throws `TooManyEmojiError`.
 */
export async function setReaction(
  db: Db,
  input: { channel: ChannelRow; messageId: string; userId: string; emoji: string; on: boolean },
): Promise<(MessageReactions & { changed: boolean }) | null> {
  const { channel, messageId, userId, emoji, on } = input;
  let changed = true;
  try {
    await db.transaction(async (tx) => {
      const seq = await nextSeq(tx, channel.id);
      // Checked after the sequence lock: a delete committed since the caller read the row wins.
      const live = await tx
        .update(messages)
        .set({ changeSeq: seq })
        .where(and(eq(messages.id, messageId), isNull(messages.deletedAt)))
        .returning({ id: messages.id });
      if (live.length === 0) throw new Gone();
      if (on) {
        const [{ others = 0, mine = 0 } = {}] = await tx
          .select({
            others: sql<number>`count(distinct ${messageReactions.emoji})::int`,
            mine: sql<number>`count(*) filter (where ${messageReactions.emoji} = ${emoji})::int`,
          })
          .from(messageReactions)
          .where(eq(messageReactions.messageId, messageId));
        if (mine === 0 && others >= MESSAGE_MAX_EMOJI) throw new TooManyEmojiError();
        const added = await tx
          .insert(messageReactions)
          .values({ messageId, userId, emoji })
          .onConflictDoNothing()
          .returning({ emoji: messageReactions.emoji });
        if (added.length === 0) throw new NoChange();
      } else {
        const removed = await tx
          .delete(messageReactions)
          .where(
            and(
              eq(messageReactions.messageId, messageId),
              eq(messageReactions.userId, userId),
              eq(messageReactions.emoji, emoji),
            ),
          )
          .returning({ emoji: messageReactions.emoji });
        if (removed.length === 0) throw new NoChange();
      }
    });
  } catch (error) {
    if (error instanceof Gone) return null;
    if (!(error instanceof NoChange)) throw error;
    changed = false;
  }
  const [[row], reactions] = await Promise.all([
    db
      .select({ changeSeq: messages.changeSeq, deletedAt: messages.deletedAt })
      .from(messages)
      .where(eq(messages.id, messageId)),
    loadReactions(db, [messageId]),
  ]);
  if (!row || row.deletedAt !== null) return null;
  return {
    messageId,
    changeSeq: row.changeSeq,
    reactions: reactions.get(messageId) ?? [],
    changed,
  };
}

// Same read-only exception as `selectMessages`: the names come from the users table, joined.
/** Who added each emoji to the message, with their names, in the order of the reactions. */
export async function reactionPeople(db: Db, messageId: string): Promise<ReactionPeople> {
  const rows = await db
    .select({
      messageId: messageReactions.messageId,
      emoji: messageReactions.emoji,
      userId: messageReactions.userId,
      name: user.name,
    })
    .from(messageReactions)
    .innerJoin(user, eq(user.id, messageReactions.userId))
    .where(eq(messageReactions.messageId, messageId))
    .orderBy(...reactionOrder);
  const nameOf = new Map(rows.map((r) => [r.userId, r.name]));
  return (group(rows).get(messageId) ?? []).map((r) => ({
    emoji: r.emoji,
    people: r.userIds.map((id) => ({ id, name: nameOf.get(id) ?? '' })),
  }));
}
