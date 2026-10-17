import { randomUUID } from 'node:crypto';
import { and, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { TaskChatSummaries } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { isForeignKeyViolation } from '../../infra/db/errors.js';
import { moveFilesToGroup } from '../files/service.js';
import { runChannelMoved } from './file-hooks.js';
import { channels, messageAttachments, messages, readStates, threadReadStates } from './schema.js';

export type ChannelRow = typeof channels.$inferSelect;

/** Returns the group's chat channel, creating it on first use; safe when two first reads race. */
export async function ensureGroupChannel(db: Db, groupId: string): Promise<ChannelRow> {
  await db
    .insert(channels)
    .values({ id: randomUUID(), groupId, kind: 'group' })
    .onConflictDoNothing({ target: channels.groupId, where: sql`${channels.kind} = 'group'` });
  const [row] = await db
    .select()
    .from(channels)
    .where(and(eq(channels.groupId, groupId), eq(channels.kind, 'group')));
  return row!;
}

/** The task was deleted while its chat channel was being created (route: 404). */
export class TaskGoneError extends Error {
  constructor() {
    super('The task no longer exists');
    this.name = 'TaskGoneError';
  }
}

/**
 * Returns the task's chat channel, creating it on first use; safe when first reads race (the
 * partial unique index `channels_task_unique` keeps one per task). The caller checks that the
 * task exists and may be read; a task deleted meanwhile throws `TaskGoneError`.
 */
export async function ensureTaskChannel(
  db: Db,
  task: { id: string; groupId: string },
): Promise<ChannelRow> {
  try {
    await db
      .insert(channels)
      .values({ id: randomUUID(), groupId: task.groupId, kind: 'task', taskId: task.id })
      .onConflictDoNothing({ target: channels.taskId, where: isNotNull(channels.taskId) });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw new TaskGoneError();
    throw error;
  }
  const [row] = await db.select().from(channels).where(eq(channels.taskId, task.id));
  if (!row) throw new TaskGoneError();
  return row;
}

/**
 * The ticket's chat channel (Phase 21), created if missing; safe when two writers race (the
 * partial unique index `channels_ticket_unique` keeps one per ticket). Only a ticket with a
 * client has a chat: the ticket module calls this when the ticket gets its client.
 */
export async function ensureTicketChannel(
  db: Db,
  ticket: { id: string; groupId: string },
): Promise<ChannelRow> {
  await db
    .insert(channels)
    .values({ id: randomUUID(), groupId: ticket.groupId, kind: 'ticket', ticketId: ticket.id })
    .onConflictDoNothing({ target: channels.ticketId, where: isNotNull(channels.ticketId) });
  const [row] = await db.select().from(channels).where(eq(channels.ticketId, ticket.id));
  return row!;
}

/** The ticket's chat channel, or null while the ticket has none (no client yet). */
export async function getTicketChannel(db: Db, ticketId: string): Promise<ChannelRow | null> {
  const [row] = await db.select().from(channels).where(eq(channels.ticketId, ticketId));
  return row ?? null;
}

/** The task's chat channel, or null while nobody has opened it (it is created on first use). */
export async function getTaskChannel(db: Db, taskId: string): Promise<ChannelRow | null> {
  const [row] = await db.select().from(channels).where(eq(channels.taskId, taskId));
  return row ?? null;
}

/**
 * Moves a ticket's chat to the ticket's new group, with the files of its messages, so the
 * messages and their attachments stay readable there. One transaction; no-op without a chat.
 */
export async function moveTicketChannel(db: Db, ticketId: string, groupId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [channel] = await tx
      .update(channels)
      .set({ groupId })
      .where(eq(channels.ticketId, ticketId))
      .returning({ id: channels.id });
    if (!channel) return;
    await runChannelMoved(tx, { channelId: channel.id, groupId });
    const attached = await tx
      .select({ fileId: messageAttachments.fileId })
      .from(messageAttachments)
      .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
      .where(eq(messages.channelId, channel.id));
    await moveFilesToGroup(
      tx,
      attached.map((a) => a.fileId),
      groupId,
    );
  });
}

/**
 * The ids of the files attached to any message of the task's chat (none when it has no chat).
 * Call it inside the transaction that deletes the task: it first locks the channel row, so a
 * send, edit or delete in that chat (they lock it through `nextSeq`) either committed before the
 * list is read or waits until the channel is gone, and no attached file is missed.
 */
export async function taskChatFileIds(tx: Db, taskId: string): Promise<string[]> {
  const [channel] = await tx
    .select({ id: channels.id })
    .from(channels)
    .where(eq(channels.taskId, taskId))
    .for('update');
  if (!channel) return [];
  const rows = await tx
    .select({ fileId: messageAttachments.fileId })
    .from(messageAttachments)
    .innerJoin(messages, eq(messages.id, messageAttachments.messageId))
    .where(eq(messages.channelId, channel.id));
  return rows.map((r) => r.fileId);
}

export async function getChannel(db: Db, id: string): Promise<ChannelRow | null> {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row ?? null;
}

/** The channel was deleted (with its task or group) after the caller loaded it (route: 404). */
export class ChannelGoneError extends Error {
  constructor() {
    super('The channel no longer exists');
    this.name = 'ChannelGoneError';
  }
}

/**
 * Bumps and returns the channel counter; the row lock also serialises writers of one channel. A
 * writer that waited on a task or group delete finds no row: `ChannelGoneError`.
 */
export async function nextSeq(tx: Db, channelId: string): Promise<number> {
  const [row] = await tx
    .update(channels)
    .set({ lastSeq: sql`${channels.lastSeq} + 1` })
    .where(eq(channels.id, channelId))
    .returning({ lastSeq: channels.lastSeq });
  if (!row) throw new ChannelGoneError();
  return row.lastSeq;
}

/** Moves the read cursor forward only, never past the server's now; returns the stored value. */
export async function markRead(db: Db, userId: string, channelId: string, at: Date): Promise<Date> {
  const [row] = await db
    .insert(readStates)
    .values({ userId, channelId, lastReadAt: sql`least(${at.toISOString()}::timestamptz, now())` })
    .onConflictDoUpdate({
      target: [readStates.userId, readStates.channelId],
      set: {
        lastReadAt: sql`greatest(${readStates.lastReadAt}, least(${at.toISOString()}::timestamptz, now()))`,
      },
    })
    .returning({ lastReadAt: readStates.lastReadAt });
  return row!.lastReadAt;
}

/**
 * Reads the whole channel up to now for the user: the channel mark and every thread of theirs
 * with unread replies (only those rows, through `thread_read_states_unread_idx`). The marks use
 * the database clock, which also stamps the messages. A channel deleted meanwhile (with its task)
 * throws `ChannelGoneError`.
 */
export async function markAllRead(db: Db, userId: string, channelId: string): Promise<Date> {
  // now() is the transaction's start time, not the moment of the write; markRead's least(at, now())
  // has the same behaviour.
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(readStates)
        .values({ userId, channelId, lastReadAt: sql`now()` })
        .onConflictDoUpdate({
          target: [readStates.userId, readStates.channelId],
          set: { lastReadAt: sql`greatest(${readStates.lastReadAt}, now())` },
        })
        .returning({ lastReadAt: readStates.lastReadAt });
      await tx
        .update(threadReadStates)
        .set({
          lastReadAt: sql`greatest(${threadReadStates.lastReadAt}, ${threadReadStates.lastReplyAt})`,
        })
        .where(
          and(
            eq(threadReadStates.userId, userId),
            eq(threadReadStates.channelId, channelId),
            sql`${threadReadStates.lastReplyAt} > ${threadReadStates.lastReadAt}`,
          ),
        );
      return row!.lastReadAt;
    });
  } catch (error) {
    if (isForeignKeyViolation(error)) throw new ChannelGoneError();
    throw error;
  }
}

export async function getLastReadAt(
  db: Db,
  userId: string,
  channelId: string,
): Promise<Date | null> {
  const [row] = await db
    .select({ lastReadAt: readStates.lastReadAt })
    .from(readStates)
    .where(and(eq(readStates.userId, userId), eq(readStates.channelId, channelId)));
  return row?.lastReadAt ?? null;
}

/** Unread counts stop here: the UI shows "99+", so counting further would only cost time. */
export const UNREAD_CAP = 100;

/**
 * The unread top-level messages of channel `c` for the user: by others, not deleted, after the
 * channel's read mark (`rs`, the user's `read_states` row joined by the caller). A `from ... where`
 * fragment: the caller selects from it.
 */
const topLevelUnread = (userId: string) => sql`
  from messages m
  where m.channel_id = c.id
    and m.parent_id is null
    and m.deleted_at is null
    and m.author_id <> ${userId}
    and m.created_at > coalesce(rs.last_read_at, '-infinity'::timestamptz)
`;

/**
 * The unread replies of channel `c` for the user: by others, not deleted, after the thread's read
 * mark, in the threads the user is one of the people of. Only threads with a reply after the mark
 * are looked at (`thread_read_states_unread_idx`). A `from ... where` fragment.
 */
const threadUnread = (userId: string) => sql`
  from thread_read_states t
  join messages m
    on m.channel_id = t.channel_id
    and m.parent_id = t.root_id
    and m.created_at > t.last_read_at
  where t.user_id = ${userId}
    and t.channel_id = c.id
    and t.last_reply_at > t.last_read_at
    and m.deleted_at is null
    and m.author_id <> ${userId}
`;

/**
 * The unread messages of channel `c` for the user, at most `UNREAD_CAP`: top-level messages by
 * others after the channel's read mark (`rs`), plus replies by others after the thread's read
 * mark in the threads the user is one of the people of. Only threads with a reply after the mark
 * are looked at (`thread_read_states_unread_idx`); each part is then one index range per channel
 * or thread (`messages_channel_parent_created_idx`).
 */
const unreadIn = (userId: string) => sql`
  select count(*)::int as n
  from (
    (select 1 ${topLevelUnread(userId)} limit ${UNREAD_CAP})
    union all
    (select 1 ${threadUnread(userId)} limit ${UNREAD_CAP})
    limit ${UNREAD_CAP}
  ) capped
`;

/** Counts per channel in one query: `c` is the channel, `rs` the user's read state of it. */
const unreadPerChannel = (userId: string, where: SQL) => sql`
  select c.id as channel_id, c.group_id, u.n
  from channels c
  left join read_states rs on rs.channel_id = c.id and rs.user_id = ${userId}
  cross join lateral (${unreadIn(userId)}) u
  where ${where}
`;

/** The channel's unread count for the user (at most `UNREAD_CAP`). */
export async function unreadCount(db: Db, userId: string, channelId: string): Promise<number> {
  const rows = await db.execute<{ n: number }>(unreadPerChannel(userId, sql`c.id = ${channelId}`));
  return [...rows][0]?.n ?? 0;
}

/**
 * `(group_id, n)` for every group chat: the user's unread count of each group's chat (at most
 * `UNREAD_CAP`), zeros included. A subquery for other modules' single statements (the admin
 * sidebar joins it to `groups`).
 */
export function unreadByGroupSql(userId: string): SQL {
  return sql`select group_id, n from (${unreadPerChannel(userId, sql`c.kind = 'group'`)}) per_channel`;
}

/**
 * Unread counts per group in one query; groups without unread messages are absent. Each channel
 * counts at most `UNREAD_CAP` messages, so the cost does not grow with the history.
 */
export async function unreadByGroup(
  db: Db,
  userId: string,
  onlyGroupIds: readonly string[] | null,
): Promise<Record<string, number>> {
  const onlyGroup =
    onlyGroupIds === null
      ? sql``
      : sql`and group_id in (${sql.join(
          onlyGroupIds.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  const rows = await db.execute<{ group_id: string; n: number }>(sql`
    select group_id, n
    from (${unreadByGroupSql(userId)}) by_group
    where n > 0 ${onlyGroup}
  `);
  return Object.fromEntries([...rows].map((r) => [r.group_id, r.n]));
}

/**
 * The chat of every task of the group that has one, for the board, in one statement: `count` is
 * its live messages (replies included), `unread` whether it has anything unread for the user by
 * the same predicates as `unreadIn` (`topLevelUnread`, `threadUnread`), each in an `exists` that
 * stops at the first hit. Tasks without a chat are absent. Checks no permissions.
 */
export async function taskChatSummaries(
  db: Db,
  userId: string,
  groupId: string,
): Promise<TaskChatSummaries> {
  const rows = await db.execute<{ task_id: string; count: number; unread: boolean }>(sql`
    select
      c.task_id,
      (
        select count(*)::int
        from messages m
        where m.channel_id = c.id
          and m.deleted_at is null
      ) as count,
      (
        exists (select 1 ${topLevelUnread(userId)})
        or exists (select 1 ${threadUnread(userId)})
      ) as unread
    from channels c
    left join read_states rs on rs.channel_id = c.id and rs.user_id = ${userId}
    where c.group_id = ${groupId}
      and c.kind = 'task'
  `);
  return Object.fromEntries(
    [...rows].map((r) => [r.task_id, { count: r.count, unread: r.unread }]),
  );
}

/** The roots of the channel's threads with replies the user has not read (at most `UNREAD_CAP`). */
export async function unreadThreads(db: Db, userId: string, channelId: string): Promise<string[]> {
  const rows = await db.execute<{ root_id: string }>(sql`
    select t.root_id
    from thread_read_states t
    where t.user_id = ${userId}
      and t.channel_id = ${channelId}
      and t.last_reply_at > t.last_read_at
      and exists (
        select 1
        from messages m
        where m.channel_id = t.channel_id
          and m.parent_id = t.root_id
          and m.created_at > t.last_read_at
          and m.deleted_at is null
          and m.author_id <> ${userId}
      )
    limit ${UNREAD_CAP}
  `);
  return [...rows].map((r) => r.root_id);
}

/**
 * Marks the thread read up to now for one of its people; null (and nothing written) when the
 * user is not one of them, so opening a thread never makes anyone follow it.
 */
export async function markThreadRead(db: Db, userId: string, rootId: string): Promise<Date | null> {
  const [row] = await db
    .update(threadReadStates)
    .set({ lastReadAt: sql`greatest(${threadReadStates.lastReadAt}, now())` })
    .where(and(eq(threadReadStates.rootId, rootId), eq(threadReadStates.userId, userId)))
    .returning({ lastReadAt: threadReadStates.lastReadAt });
  return row?.lastReadAt ?? null;
}

/**
 * Records a new reply in the thread's read states (inside the send transaction, after the reply
 * row): every person of the thread learns the newest reply time, the replier has read the thread
 * up to it, and the root author becomes one of its people with nothing read yet. Repliers before
 * them already have a row (from their own reply).
 *
 * "Newest" is the latest reply this transaction sees, not the new reply's own time: a concurrent
 * reply can take a later `created_at` yet commit first (the channel row lock orders the writers),
 * and the replier saw it, so it must not stay unread for them.
 *
 * `mentionedIds` (Phase 20) are the people the reply names (never @all): each, other than the
 * replier, becomes one of the thread's people with a read mark just before the reply, so the reply
 * is unread for them. An existing row keeps its read mark: a mention never marks older replies read.
 */
export async function recordReplyReads(
  tx: Db,
  reply: { channelId: string; rootId: string; authorId: string; createdAt?: Date },
  root: { authorId: string; createdAt: Date },
  mentionedIds: string[] = [],
): Promise<void> {
  const [newest] = await tx
    .select({ at: sql<Date>`max(${messages.createdAt})`.mapWith(messages.createdAt) })
    .from(messages)
    .where(and(eq(messages.channelId, reply.channelId), eq(messages.parentId, reply.rootId)));
  const latest = newest!.at;
  await tx
    .update(threadReadStates)
    .set({
      lastReplyAt: sql`greatest(${threadReadStates.lastReplyAt}, ${latest.toISOString()}::timestamptz)`,
    })
    .where(eq(threadReadStates.rootId, reply.rootId));
  const row = (userId: string, lastReadAt: Date) => ({
    userId,
    rootId: reply.rootId,
    channelId: reply.channelId,
    lastReadAt,
    lastReplyAt: latest,
  });
  const rows = [row(reply.authorId, latest)];
  if (root.authorId !== reply.authorId) rows.push(row(root.authorId, root.createdAt));
  await tx
    .insert(threadReadStates)
    .values(rows)
    .onConflictDoUpdate({
      target: [threadReadStates.rootId, threadReadStates.userId],
      set: {
        lastReadAt: sql`greatest(${threadReadStates.lastReadAt}, excluded.last_read_at)`,
        lastReplyAt: sql`greatest(${threadReadStates.lastReplyAt}, excluded.last_reply_at)`,
      },
    });
  const named = [...new Set(mentionedIds)].filter((id) => id !== reply.authorId);
  if (named.length === 0) return;
  const replyAt = reply.createdAt ?? latest;
  const before = new Date(replyAt.getTime() - 1);
  await tx
    .insert(threadReadStates)
    .values(named.map((userId) => row(userId, before)))
    .onConflictDoUpdate({
      target: [threadReadStates.rootId, threadReadStates.userId],
      set: {
        lastReplyAt: sql`greatest(${threadReadStates.lastReplyAt}, excluded.last_reply_at)`,
      },
    });
}

/**
 * After a reply is deleted (inside the delete transaction): a person of the thread with nothing
 * unread left in it is marked read up to the newest reply, so the row leaves the unread index.
 */
export async function settleThreadReads(tx: Db, rootId: string): Promise<void> {
  await tx.execute(sql`
    update thread_read_states t
    set last_read_at = t.last_reply_at
    where t.root_id = ${rootId}
      and t.last_reply_at > t.last_read_at
      and not exists (
        select 1
        from messages m
        where m.channel_id = t.channel_id
          and m.parent_id = t.root_id
          and m.created_at > t.last_read_at
          and m.deleted_at is null
          and m.author_id <> t.user_id
      )
  `);
}
