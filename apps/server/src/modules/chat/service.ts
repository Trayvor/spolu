import { randomUUID } from 'node:crypto';
import { and, count, eq, sql } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { channels, messages, readStates } from './schema.js';

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

export async function getChannel(db: Db, id: string): Promise<ChannelRow | null> {
  const [row] = await db.select().from(channels).where(eq(channels.id, id));
  return row ?? null;
}

/** Bumps and returns the channel counter; the row lock also serialises writers of one channel. */
export async function nextSeq(tx: Db, channelId: string): Promise<number> {
  const [row] = await tx
    .update(channels)
    .set({ lastSeq: sql`${channels.lastSeq} + 1` })
    .where(eq(channels.id, channelId))
    .returning({ lastSeq: channels.lastSeq });
  return row!.lastSeq;
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

export async function unreadCount(db: Db, userId: string, channelId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(messages)
    .leftJoin(
      readStates,
      and(eq(readStates.channelId, messages.channelId), eq(readStates.userId, userId)),
    )
    .where(
      and(
        eq(messages.channelId, channelId),
        sql`${messages.parentId} is null`,
        sql`${messages.deletedAt} is null`,
        sql`${messages.authorId} <> ${userId}`,
        sql`${messages.createdAt} > coalesce(${readStates.lastReadAt}, '-infinity'::timestamptz)`,
      ),
    );
  return row?.n ?? 0;
}

/** Unread counts stop here: the UI shows "99+", so counting further would only cost time. */
export const UNREAD_CAP = 100;

/**
 * Unread counts per group in one query; groups without unread messages are absent. Each channel
 * counts at most `UNREAD_CAP` messages, so the cost does not grow with the history.
 */
export async function unreadByGroup(
  db: Db,
  userId: string,
  onlyGroupId: string | null,
): Promise<Record<string, number>> {
  const rows = await db.execute<{ group_id: string; n: number }>(sql`
    select c.group_id, u.n
    from channels c
    left join read_states rs on rs.channel_id = c.id and rs.user_id = ${userId}
    cross join lateral (
      select count(*)::int as n
      from (
        select 1
        from messages m
        where m.channel_id = c.id
          and m.parent_id is null
          and m.deleted_at is null
          and m.author_id <> ${userId}
          and m.created_at > coalesce(rs.last_read_at, '-infinity'::timestamptz)
        limit ${UNREAD_CAP}
      ) capped
    ) u
    where c.kind = 'group'
      and u.n > 0
      ${onlyGroupId === null ? sql`` : sql`and c.group_id = ${onlyGroupId}`}
  `);
  return Object.fromEntries([...rows].map((r) => [r.group_id, r.n]));
}
