import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  extractMentions,
  plainExcerpt,
  type MessageDto,
  type NotificationKind,
  type SendMessageInput,
  type SessionUser,
} from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { Db } from '../../infra/db/client.js';
import { attachFiles } from '../files/service.js';
import { listGroupPeople } from '../groups/service.js';
import { recordNotifications } from '../notifications/service.js';
import { isUniqueViolation } from '../users/service.js';
import { selectMessages, toMessageDtos } from './dto.js';
import { messageAttachments, messageMentions, messages } from './schema.js';
import { getChannel, nextSeq, type ChannelRow } from './service.js';

const EXCERPT_LENGTH = 140;

/** A mentioned id is not one of the group's people (route: 400 invalid_mention). */
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
 * author). A repeated `clientId` of the same author returns the stored message with
 * `created: false` and writes nothing; `parent` is then null. `parent` is the updated root of a
 * new reply, for the caller to push.
 */
export async function sendMessage(
  deps: AppDeps,
  input: { channel: ChannelRow; author: SessionUser; data: SendMessageInput },
): Promise<{ message: MessageDto; parent: MessageDto | null; created: boolean }> {
  const { db } = deps;
  const { channel, author, data } = input;
  const groupId = channel.groupId;

  const existing = await findByClientId(db, channel, author.id, data.clientId);
  if (existing) return { message: existing, parent: null, created: false };

  await checkThread(db, channel.id, data);

  const mentions = extractMentions(data.body);
  const people = await listGroupPeople(db, groupId);
  const nameById = new Map(people.map((p) => [p.id, p.name]));
  if (mentions.userIds.some((id) => !nameById.has(id))) throw new InvalidMentionError();

  const messageId = randomUUID();
  const parentId = data.parentId ?? null;
  const fileIds = data.fileIds ?? [];
  const others = (ids: Iterable<string>) => [...ids].filter((id) => id !== author.id);

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

      let threadPeople: string[] = [];
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
          .returning({ authorId: messages.authorId });
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
        threadPeople = [root!.authorId, ...repliers.map((r) => r.authorId)];
      }

      const payload = {
        channelId: channel.id,
        messageId,
        groupId,
        authorName: author.name,
        excerpt: plainExcerpt(data.body, (id) => nameById.get(id), EXCERPT_LENGTH),
      };
      const notify = (kind: NotificationKind, recipients: string[]) =>
        recordNotifications(tx, { kind, groupId, recipients: others(recipients), payload });
      const everyone = people.map((p) => p.id);
      // Replies only notify the thread; the channel hears about top-level messages.
      if (parentId === null) await notify('chat.message', everyone);
      await notify('chat.mention', mentions.all ? everyone : mentions.userIds);
      // Only people who still belong to the group hear about the thread.
      if (parentId !== null)
        await notify(
          'chat.thread_reply',
          threadPeople.filter((id) => nameById.has(id)),
        );
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    // A concurrent send with the same clientId won the unique index.
    const winner = await findByClientId(db, channel, author.id, data.clientId);
    if (!winner) throw error;
    return { message: winner, parent: null, created: false };
  }

  const ids = parentId === null ? [messageId] : [messageId, parentId];
  const rows = await selectMessages(db, inArray(messages.id, ids), []);
  const dtos = await toMessageDtos(db, groupId, rows);
  const message = dtos.find((m) => m.id === messageId)!;
  const parent = dtos.find((m) => m.id === parentId) ?? null;
  return { message, parent, created: true };
}
