import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  extractMentions,
  isPickable,
  type FileInfo,
  ID_RE,
  plainExcerpt,
  type ChatMessageTasksEvent,
  type MessageDto,
  type NotificationKind,
  type SendMessageInput,
  type SessionUser,
  type SourceMessage,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { isUniqueViolation } from '../../infra/db/errors.js';
import {
  attachFiles,
  deleteDetachedFiles,
  detachFiles,
  getFilesForGroup,
} from '../files/service.js';
import { listGroupPeople } from '../groups/service.js';
import { recordNotifications, requestDelivery } from '../notifications/service.js';
import { listTasksForMessages } from '../tasks/service.js';
import { isAdmin } from '../users/policy.js';
import { user } from '../users/schema.js';
import { selectMessages, toMessageDtos, type MessageRow } from './dto.js';
import { canReadChannel } from './policy.js';
import { channels, messageAttachments, messageMentions, messages } from './schema.js';
import {
  getChannel,
  nextSeq,
  recordReplyReads,
  settleThreadReads,
  type ChannelRow,
} from './service.js';
import { clientGroupIds } from '../groups/memberships.js';

const EXCERPT_LENGTH = 140;

/** A mentioned id is not one of the group's pickable people (clients and managers) (route: 400 invalid_mention). */
export class InvalidMentionError extends Error {
  constructor() {
    super('A mentioned user is not one of the group people');
    this.name = 'InvalidMentionError';
  }
}

/** `parentId` is not a top-level message of the channel, or `replyToId` is not in its thread. */
export class InvalidThreadError extends Error {
  constructor() {
    super('The parent or the replied-to message is not in this thread');
    this.name = 'InvalidThreadError';
  }
}

/** An edit would leave a message without text and attachments (route: 400 validation_failed). */
export class EmptyMessageError extends Error {
  constructor() {
    super('A message needs text or an attachment');
    this.name = 'EmptyMessageError';
  }
}

/** The message is deleted and can no longer be edited (route: 404 not_found). */
export class MessageDeletedError extends Error {
  constructor() {
    super('The message is deleted');
    this.name = 'MessageDeletedError';
  }
}

/** The author's message with this clientId; its DTO uses its own channel's group (it may be another chat). */
async function findByClientId(
  db: Db,
  channel: ChannelRow,
  authorId: string,
  clientId: string,
): Promise<MessageDto | null> {
  const rows = await selectMessages(
    db,
    and(eq(messages.authorId, authorId), eq(messages.clientId, clientId)),
    [],
  );
  const row = rows[0];
  if (!row) return null;
  const groupId =
    row.channelId === channel.id ? channel.groupId : (await getChannel(db, row.channelId))!.groupId;
  const [dto] = await toMessageDtos(db, groupId, rows);
  return dto ?? null;
}

/** Throws InvalidThreadError unless the parent is a root of the channel and replyTo is in its thread. */
async function checkThread(db: Db, channelId: string, data: SendMessageInput): Promise<void> {
  const { parentId, replyToId } = data;
  if (parentId === undefined) return;
  const ids = replyToId === undefined ? [parentId] : [parentId, replyToId];
  const rows = await db
    .select({ id: messages.id, channelId: messages.channelId, parentId: messages.parentId })
    .from(messages)
    .where(inArray(messages.id, ids));
  const parent = rows.find((r) => r.id === parentId);
  if (!parent || parent.channelId !== channelId || parent.parentId !== null) {
    throw new InvalidThreadError();
  }
  if (replyToId === undefined || replyToId === parentId) return;
  const replyTo = rows.find((r) => r.id === replyToId);
  if (replyTo?.parentId !== parentId) throw new InvalidThreadError();
}

/**
 * Sends a message, or a reply when `parentId` is set, in one transaction: sequence, row,
 * mentions, attachments, the parent's reply count and the notification events (never for the
 * author), whose delivery is requested after the commit. A repeated `clientId` of the same author
 * returns the stored message with `created: false` and writes nothing; `parent` is then null. `parent` is the updated root of a
 * new reply, for the caller to push; `threadPeople` are the people of its thread still in the
 * group, without the author (the reply counts as unread for them), including the people the reply
 * names (never @all), who become people of the thread.
 */
export async function sendMessage(
  deps: AppDeps,
  input: { channel: ChannelRow; author: SessionUser; data: SendMessageInput },
): Promise<{
  message: MessageDto;
  parent: MessageDto | null;
  created: boolean;
  threadPeople: string[];
}> {
  const { db } = deps;
  const { channel, author, data } = input;
  const groupId = channel.groupId;

  const existing = await findByClientId(db, channel, author.id, data.clientId);
  if (existing) return { message: existing, parent: null, created: false, threadPeople: [] };

  await checkThread(db, channel.id, data);

  const mentions = extractMentions(data.body);
  const people = await listGroupPeople(db, groupId);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  // New mentions and @all reach clients and managers only; chat.message and threads reach readers.
  const pickable = new Set(people.filter(isPickable).map((p) => p.id));
  if (mentions.userIds.some((id) => !pickable.has(id))) throw new InvalidMentionError();

  const messageId = randomUUID();
  const parentId = data.parentId ?? null;
  const fileIds = data.fileIds ?? [];
  const others = (ids: Iterable<string>) => [...ids].filter((id) => id !== author.id);
  let threadPeople: string[] = [];
  const notified = new Set<string>();

  try {
    await db.transaction(async (tx) => {
      const seq = await nextSeq(tx, channel.id);
      const [row] = await tx
        .insert(messages)
        .values({
          id: messageId,
          channelId: channel.id,
          authorId: author.id,
          parentId,
          replyToId: data.replyToId ?? null,
          body: data.body,
          mentionsAll: mentions.all,
          clientId: data.clientId,
          changeSeq: seq,
        })
        .returning({ createdAt: messages.createdAt });
      if (mentions.userIds.length > 0) {
        await tx
          .insert(messageMentions)
          .values(mentions.userIds.map((userId) => ({ messageId, userId })));
      }
      if (fileIds.length > 0) {
        await attachFiles(tx, groupId, fileIds, author.id);
        await tx
          .insert(messageAttachments)
          .values(fileIds.map((fileId, position) => ({ messageId, fileId, position })));
      }

      if (parentId !== null) {
        const [root] = await tx
          .update(messages)
          .set({
            replyCount: sql`${messages.replyCount} + 1`,
            // Concurrent replies may commit with inverted created_at; never move it back.
            lastReplyAt: sql`greatest(${messages.lastReplyAt}, ${row!.createdAt.toISOString()}::timestamptz)`,
            changeSeq: seq,
          })
          .where(eq(messages.id, parentId))
          .returning({ authorId: messages.authorId, createdAt: messages.createdAt });
        // checkThread found the root; messages are only soft-deleted, so the row still exists.
        const repliers = await tx
          .selectDistinct({ authorId: messages.authorId })
          .from(messages)
          .where(
            and(
              eq(messages.channelId, channel.id),
              eq(messages.parentId, parentId),
              sql`${messages.id} <> ${messageId}`,
            ),
          );
        // Only people who still belong to the group hear about the thread.
        threadPeople = others(new Set([root!.authorId, ...repliers.map((r) => r.authorId)])).filter(
          (id) => nameById.has(id),
        );
        // Naming someone in a reply makes them one of the thread's people (never @all).
        await recordReplyReads(
          tx,
          {
            channelId: channel.id,
            rootId: parentId,
            authorId: author.id,
            createdAt: row!.createdAt,
          },
          root!,
          mentions.userIds,
        );
      }

      const payload = {
        channelId: channel.id,
        taskId: channel.taskId,
        messageId,
        groupId,
        authorName: author.name,
        excerpt: plainExcerpt(data.body, (id) => nameById.get(id), EXCERPT_LENGTH),
      };
      const notify = async (kind: NotificationKind, recipients: string[]) => {
        const recorded = await recordNotifications(tx, {
          kind,
          groupId,
          recipients: others(recipients),
          payload,
        });
        for (const id of recorded) notified.add(id);
      };
      const everyone = people.map((p) => p.id);
      // Replies only notify the thread; the channel hears about top-level messages.
      if (parentId === null) await notify('chat.message', everyone);
      await notify('chat.mention', mentions.all ? [...pickable] : mentions.userIds);
      if (parentId !== null) {
        // The named people already get chat.mention; the thread notice stays with the old people.
        await notify('chat.thread_reply', threadPeople);
        const named = others(mentions.userIds).filter((id) => nameById.has(id));
        threadPeople = [...new Set([...threadPeople, ...named])];
      }
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent send with the same clientId won the unique index.
    const winner = await findByClientId(db, channel, author.id, data.clientId);
    if (!winner) throw error;
    return { message: winner, parent: null, created: false, threadPeople: [] };
  }

  await requestDelivery(deps.jobs, [...notified]);
  const ids = parentId === null ? [messageId] : [messageId, parentId];
  const rows = await selectMessages(db, inArray(messages.id, ids), []);
  const dtos = await toMessageDtos(db, groupId, rows);
  const message = dtos.find((m) => m.id === messageId)!;
  const parent = dtos.find((m) => m.id === parentId) ?? null;
  return { message, parent, created: true, threadPeople };
}

export async function getMessage(db: Db, id: string): Promise<MessageRow | null> {
  const [row] = await db.select().from(messages).where(eq(messages.id, id));
  return row ?? null;
}

/** The files attached to a message, in their order (two queries; [] for a deleted message). */
export async function getMessageFiles(
  db: Db,
  groupId: string,
  messageId: string,
): Promise<FileInfo[]> {
  const rows = await db
    .select({ fileId: messageAttachments.fileId })
    .from(messageAttachments)
    .where(eq(messageAttachments.messageId, messageId))
    .orderBy(asc(messageAttachments.position));
  return getFilesForGroup(
    db,
    groupId,
    rows.map((r) => r.fileId),
  );
}

// Same read-only exception as `selectMessages`: author and mentioned names come from `user`.
/**
 * The message a task was made from, for the task panel: author name, a one-line excerpt with
 * mentions as names, its channel and that channel's task (null in the group chat). One query;
 * null when the message is missing or deleted.
 */
export async function getSourceMessage(db: Db, messageId: string): Promise<SourceMessage | null> {
  const [row] = await db
    .select({
      id: messages.id,
      channelId: messages.channelId,
      taskId: channels.taskId,
      body: messages.body,
      deletedAt: messages.deletedAt,
      authorName: user.name,
      mentionNames: sql<Record<string, string>>`coalesce((
        select json_object_agg(mu.id, mu.name)
        from ${messageMentions} join ${user} mu on mu.id = ${messageMentions.userId}
        where ${messageMentions.messageId} = ${messages.id}
      ), '{}'::json)`,
    })
    .from(messages)
    .innerJoin(channels, eq(channels.id, messages.channelId))
    .innerJoin(user, eq(user.id, messages.authorId))
    .where(eq(messages.id, messageId));
  if (!row || row.deletedAt !== null) return null;
  return {
    id: row.id,
    channelId: row.channelId,
    taskId: row.taskId,
    authorName: row.authorName,
    excerpt: plainExcerpt(row.body, (id) => row.mentionNames[id], EXCERPT_LENGTH),
  };
}

/**
 * The `chat:message_tasks` event of a message: its place and its current tasks (two queries in
 * parallel). Null when the message is missing or deleted (its footer is gone).
 */
export async function messageTasksEvent(
  db: Db,
  messageId: string,
): Promise<ChatMessageTasksEvent | null> {
  const [[row], tasksOf] = await Promise.all([
    db
      .select({
        channelId: messages.channelId,
        parentId: messages.parentId,
        deletedAt: messages.deletedAt,
        groupId: channels.groupId,
      })
      .from(messages)
      .innerJoin(channels, eq(channels.id, messages.channelId))
      .where(eq(messages.id, messageId)),
    listTasksForMessages(db, [messageId]),
  ]);
  if (!row || row.deletedAt !== null) return null;
  return {
    groupId: row.groupId,
    channelId: row.channelId,
    messageId,
    parentId: row.parentId,
    tasks: tasksOf.get(messageId) ?? [],
  };
}

/**
 * The message with its channel when the actor may read that channel, else null: a missing
 * message, a malformed id and an unreadable channel all look the same (the routes answer 404).
 */
export async function findReadableMessage(
  db: Db,
  actor: SessionUser,
  id: string,
): Promise<{ message: MessageRow; channel: ChannelRow } | null> {
  // A malformed id cannot exist; checking first keeps NUL and the like away from Postgres.
  const message = ID_RE.test(id) ? await getMessage(db, id) : null;
  const channel = message ? await getChannel(db, message.channelId) : null;
  if (!message || !channel) return null;
  const actorGroupIds = isAdmin(actor) ? [] : await clientGroupIds(db, actor.id);
  return canReadChannel(actor, channel, actorGroupIds) ? { message, channel } : null;
}

async function loadDto(db: Db, groupId: string, id: string): Promise<MessageDto> {
  const rows = await selectMessages(db, eq(messages.id, id), []);
  return (await toMessageDtos(db, groupId, rows))[0]!;
}

/**
 * Replaces the body of a live message in one transaction: mentions are re-parsed and validated
 * against the pickable people (mentions already on the message stay valid), `edited_at` and `change_seq` move. No notifications are recorded.
 * An empty body is allowed only while the message has attachments.
 */
export async function editMessage(
  deps: AppDeps,
  input: { message: MessageRow; channel: ChannelRow; body: string },
): Promise<MessageDto> {
  const { db } = deps;
  const { message, channel, body } = input;
  if (message.deletedAt !== null) throw new MessageDeletedError();

  const mentions = extractMentions(body);
  const people = await listGroupPeople(db, channel.groupId);
  const known = new Set(people.filter(isPickable).map((p) => p.id));
  // Mentions already on the message stay valid even if that person has left the group since.
  const stored = await db
    .select({ userId: messageMentions.userId })
    .from(messageMentions)
    .where(eq(messageMentions.messageId, message.id));
  for (const { userId } of stored) known.add(userId);
  if (mentions.userIds.some((id) => !known.has(id))) throw new InvalidMentionError();

  await db.transaction(async (tx) => {
    const seq = await nextSeq(tx, channel.id);
    // Checked after the sequence lock: a delete committed since the caller read the row wins.
    const updated = await tx
      .update(messages)
      .set({ body, mentionsAll: mentions.all, editedAt: sql`now()`, changeSeq: seq })
      .where(and(eq(messages.id, message.id), isNull(messages.deletedAt)))
      .returning({ id: messages.id });
    if (updated.length === 0) throw new MessageDeletedError();
    if (body.trim().length === 0) {
      const [attachment] = await tx
        .select({ fileId: messageAttachments.fileId })
        .from(messageAttachments)
        .where(eq(messageAttachments.messageId, message.id))
        .limit(1);
      // Throwing rolls the whole transaction back, the update included.
      if (!attachment) throw new EmptyMessageError();
    }
    await tx.delete(messageMentions).where(eq(messageMentions.messageId, message.id));
    if (mentions.userIds.length > 0) {
      await tx
        .insert(messageMentions)
        .values(mentions.userIds.map((userId) => ({ messageId: message.id, userId })));
    }
  });
  return loadDto(db, channel.groupId, message.id);
}

/**
 * Soft-deletes a message in one transaction: the row stays (threads keep working), body and
 * mentions are cleared, attachment rows go, `change_seq` moves. Its files are deleted after the
 * commit, best effort (leftovers are unattached for the daily cleanup). A reply's deletion leaves the root's `reply_count` as it is. Deleting twice is a no-op.
 */
export async function deleteMessage(
  deps: AppDeps,
  input: {
    message: MessageRow;
    channel: ChannelRow;
    /** Called when the post-commit file removal fails (the caller logs it with request context). */
    onFileCleanupError?: (error: unknown) => void;
  },
): Promise<MessageDto> {
  const { db } = deps;
  const { message, channel } = input;
  if (message.deletedAt !== null) return loadDto(db, channel.groupId, message.id);

  const fileIds = await db.transaction(async (tx) => {
    const seq = await nextSeq(tx, channel.id);
    await tx
      .update(messages)
      .set({ deletedAt: sql`now()`, body: '', mentionsAll: false, changeSeq: seq })
      .where(eq(messages.id, message.id));
    await tx.delete(messageMentions).where(eq(messageMentions.messageId, message.id));
    const removed = await tx
      .delete(messageAttachments)
      .where(eq(messageAttachments.messageId, message.id))
      .returning({ fileId: messageAttachments.fileId });
    const ids = removed.map((r) => r.fileId);
    // If the removal below fails, the daily unattached-files cleanup picks them up.
    await detachFiles(tx, ids);
    if (message.parentId !== null) await settleThreadReads(tx, message.parentId);
    return ids;
  });
  try {
    await deleteDetachedFiles(deps, fileIds);
  } catch (error) {
    // The message is already deleted; never fail the request over leftover files.
    (input.onFileCleanupError ?? ((e) => console.error('chat: file cleanup failed', e)))(error);
  }
  return loadDto(db, channel.groupId, message.id);
}
