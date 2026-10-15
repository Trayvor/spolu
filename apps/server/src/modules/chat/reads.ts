import { and, asc, desc, eq, gt, isNull, lt, or, type SQL } from 'drizzle-orm';
import type { AroundPage, Changes, MessagePage, Thread } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { selectMessages, toMessageDtos } from './dto.js';
import { channels, messages } from './schema.js';
import { getLastReadAt, type ChannelRow } from './service.js';

const PAGE_SIZE = 50;
const CHANGES_LIMIT = 500;

export function encodeCursor(m: { createdAt: string; id: string }): string {
  return `${m.createdAt},${m.id}`;
}

const CURSOR_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CURSOR_ID_RE = /^[\w-]{1,64}$/;

export function parseCursor(s: string): { createdAt: Date; id: string } | null {
  const at = s.indexOf(',');
  if (at < 0) return null;
  const iso = s.slice(0, at);
  const id = s.slice(at + 1);
  if (!CURSOR_DATE_RE.test(iso) || !CURSOR_ID_RE.test(id)) return null;
  const createdAt = new Date(iso);
  // The round trip rejects impossible dates such as 2026-02-31; the year bound keeps it inside
  // what Postgres timestamptz compares sanely.
  if (Number.isNaN(createdAt.getTime()) || createdAt.toISOString() !== iso) return null;
  if (createdAt.getUTCFullYear() < 1970) return null;
  return { createdAt, id };
}

type Cursor = { createdAt: Date; id: string };

/** The `(created_at, id)` tie-break keeps messages sharing a millisecond in a stable order. */
const beforeCursor = (c: Cursor): SQL =>
  or(
    lt(messages.createdAt, c.createdAt),
    and(eq(messages.createdAt, c.createdAt), lt(messages.id, c.id)),
  )!;
const afterCursor = (c: Cursor): SQL =>
  or(
    gt(messages.createdAt, c.createdAt),
    and(eq(messages.createdAt, c.createdAt), gt(messages.id, c.id)),
  )!;

const topLevel = (channelId: string): SQL =>
  and(eq(messages.channelId, channelId), isNull(messages.parentId))!;

async function readLastSeq(db: Db, channelId: string): Promise<number> {
  const [row] = await db
    .select({ lastSeq: channels.lastSeq })
    .from(channels)
    .where(eq(channels.id, channelId));
  return row?.lastSeq ?? 0;
}

async function readState(db: Db, channel: ChannelRow, userId: string) {
  // lastSeq is read before the messages: a message committed in between is then re-delivered by
  // catch-up instead of being missed.
  const lastSeq = await readLastSeq(db, channel.id);
  const lastReadAt = (await getLastReadAt(db, userId, channel.id))?.toISOString() ?? null;
  return { lastSeq, lastReadAt };
}

/** Top-level messages older than the cursor (or the newest), newest first. */
export async function pageBefore(
  db: Db,
  channel: ChannelRow,
  userId: string,
  cursor: Cursor | null,
  limit = PAGE_SIZE,
): Promise<MessagePage> {
  const state = await readState(db, channel, userId);
  const where = cursor ? and(topLevel(channel.id), beforeCursor(cursor)) : topLevel(channel.id);
  const rows = await selectMessages(
    db,
    where,
    [desc(messages.createdAt), desc(messages.id)],
    limit + 1,
  );
  const page = rows.slice(0, limit);
  return {
    messages: await toMessageDtos(db, channel.groupId, page),
    hasMore: rows.length > limit,
    ...state,
  };
}

/** Top-level messages newer than the cursor, oldest first. */
export async function pageAfter(
  db: Db,
  channel: ChannelRow,
  userId: string,
  cursor: Cursor,
  limit = PAGE_SIZE,
): Promise<MessagePage> {
  const state = await readState(db, channel, userId);
  const rows = await selectMessages(
    db,
    and(topLevel(channel.id), afterCursor(cursor)),
    [asc(messages.createdAt), asc(messages.id)],
    limit + 1,
  );
  return {
    messages: await toMessageDtos(db, channel.groupId, rows.slice(0, limit)),
    hasMore: rows.length > limit,
    ...state,
  };
}

/** The top-level message for an id of this channel; a reply resolves to its root. */
async function findRoot(db: Db, channelId: string, messageId: string) {
  const [found] = await selectMessages(
    db,
    and(eq(messages.id, messageId), eq(messages.channelId, channelId)),
    [],
  );
  if (!found) return null;
  if (found.parentId === null) return found;
  const [root] = await selectMessages(db, eq(messages.id, found.parentId), []);
  return root ?? null;
}

/** A page containing the (root of the) message: `limit / 2` older, the target, the rest newer. */
export async function pageAround(
  db: Db,
  channel: ChannelRow,
  userId: string,
  messageId: string,
  limit = PAGE_SIZE,
): Promise<AroundPage | null> {
  const target = await findRoot(db, channel.id, messageId);
  if (!target) return null;
  const state = await readState(db, channel, userId);
  const cursor = { createdAt: target.createdAt, id: target.id };
  const olderCount = Math.floor(limit / 2);
  const newerCount = limit - 1 - olderCount;
  const [older, newer] = await Promise.all([
    selectMessages(
      db,
      and(topLevel(channel.id), beforeCursor(cursor)),
      [desc(messages.createdAt), desc(messages.id)],
      olderCount + 1,
    ),
    selectMessages(
      db,
      and(topLevel(channel.id), afterCursor(cursor)),
      [asc(messages.createdAt), asc(messages.id)],
      newerCount + 1,
    ),
  ]);
  const rows = [...older.slice(0, olderCount).reverse(), target, ...newer.slice(0, newerCount)];
  return {
    messages: await toMessageDtos(db, channel.groupId, rows),
    hasOlder: older.length > olderCount,
    hasNewer: newer.length > newerCount,
    targetId: target.id,
    ...state,
  };
}

/** The root and its replies oldest first; a reply id gives the same thread. */
export async function getThread(
  db: Db,
  channel: ChannelRow,
  messageId: string,
): Promise<Thread | null> {
  const root = await findRoot(db, channel.id, messageId);
  if (!root) return null;
  const replies = await selectMessages(
    db,
    and(eq(messages.channelId, channel.id), eq(messages.parentId, root.id)),
    [asc(messages.createdAt), asc(messages.id)],
  );
  const [rootDto, ...replyDtos] = await toMessageDtos(db, channel.groupId, [root, ...replies]);
  return { root: rootDto!, replies: replyDtos };
}

/**
 * Every message (replies included) changed after `afterSeq`, ascending by `(change_seq, id)`, at
 * most 500. A reply and its root share a seq, so a truncated page never ends inside a seq: the
 * rows of the last, possibly incomplete, seq are dropped and `lastSeq` is the last complete seq,
 * which the client passes as the next `afterSeq`. If one seq alone exceeds the cap, all of its
 * rows are returned (progress beats the cap).
 */
export async function changesAfter(
  db: Db,
  channel: ChannelRow,
  afterSeq: number,
): Promise<Changes> {
  const lastSeq = await readLastSeq(db, channel.id);
  const order = [asc(messages.changeSeq), asc(messages.id)];
  const inChannel = eq(messages.channelId, channel.id);
  const rows = await selectMessages(
    db,
    and(inChannel, gt(messages.changeSeq, afterSeq)),
    order,
    CHANGES_LIMIT + 1,
  );
  if (rows.length <= CHANGES_LIMIT) {
    return { messages: await toMessageDtos(db, channel.groupId, rows), lastSeq, truncated: false };
  }
  const boundary = rows[CHANGES_LIMIT - 1]!.changeSeq;
  let kept = rows.slice(0, CHANGES_LIMIT);
  if (rows[CHANGES_LIMIT]!.changeSeq === boundary) {
    kept = kept.filter((r) => r.changeSeq < boundary);
    if (kept.length === 0) {
      kept = await selectMessages(db, and(inChannel, eq(messages.changeSeq, boundary)), order);
    }
  }
  return {
    messages: await toMessageDtos(db, channel.groupId, kept),
    lastSeq: kept.at(-1)!.changeSeq,
    truncated: true,
  };
}
