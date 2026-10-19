import { and, eq, isNull, lt, or } from 'drizzle-orm';
import type { CalendarFeed, CalendarFeedInclude } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { calendarFeeds } from './schema.js';
import { FEED_TOKEN, feedToken, feedTokenHash, isFeedToken, newFeedNonce } from './token.js';

/** The person's own feed settings (ADR 0051). Every function acts on one user's row only. */

export type FeedRow = typeof calendarFeeds.$inferSelect;

const TOUCH_EVERY_MS = 60 * 60_000;

export async function getFeed(db: Db, userId: string): Promise<FeedRow | null> {
  const [row] = await db.select().from(calendarFeeds).where(eq(calendarFeeds.userId, userId));
  return row ?? null;
}

const switches = (include: CalendarFeedInclude) => ({
  includeEvents: include.events,
  includeTasks: include.tasks,
  includeCalls: include.calls,
});

/**
 * Creates the feed with a new nonce, or changes only its switches when it exists (one
 * statement, `on conflict (user_id)`). `created` says which; `appSecret` derives the hash.
 */
export async function putFeed(
  db: Db,
  appSecret: string,
  userId: string,
  include: CalendarFeedInclude,
): Promise<{ row: FeedRow; created: boolean }> {
  const nonce = newFeedNonce();
  const [row] = await db
    .insert(calendarFeeds)
    .values({
      userId,
      nonce,
      tokenHash: feedTokenHash(feedToken(appSecret, userId, nonce)),
      ...switches(include),
    })
    .onConflictDoUpdate({
      target: calendarFeeds.userId,
      set: { ...switches(include), updatedAt: new Date() },
    })
    .returning();
  // The insert kept our nonce only when it created the row.
  return { row: row!, created: row!.nonce === nonce };
}

/** A new nonce and hash: the old link stops working at once. Null without a feed. */
export async function rotateFeed(
  db: Db,
  appSecret: string,
  userId: string,
): Promise<FeedRow | null> {
  const nonce = newFeedNonce();
  const [row] = await db
    .update(calendarFeeds)
    .set({
      nonce,
      tokenHash: feedTokenHash(feedToken(appSecret, userId, nonce)),
      lastFetchedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(calendarFeeds.userId, userId))
    .returning();
  return row ?? null;
}

/** Revokes the feed (deletes the row); also `deactivateUser`'s. False when there was none. */
export async function deleteFeedOf(db: Db, userId: string): Promise<boolean> {
  const rows = await db
    .delete(calendarFeeds)
    .where(eq(calendarFeeds.userId, userId))
    .returning({ userId: calendarFeeds.userId });
  return rows.length > 0;
}

/** The feed a URL's token opens: the hash lookup, then a constant-time check of the token. */
export async function findFeedByToken(
  db: Db,
  appSecret: string,
  token: string,
): Promise<FeedRow | null> {
  if (!FEED_TOKEN.test(token)) return null;
  const [row] = await db
    .select()
    .from(calendarFeeds)
    .where(eq(calendarFeeds.tokenHash, feedTokenHash(token)));
  return row && isFeedToken(appSecret, row, token) ? row : null;
}

/** Notes a fetch, at most once an hour (a conditional update: a poll in between writes nothing). */
export async function touchFetched(db: Db, userId: string, now: Date): Promise<void> {
  await db
    .update(calendarFeeds)
    .set({ lastFetchedAt: now })
    .where(
      and(
        eq(calendarFeeds.userId, userId),
        or(
          isNull(calendarFeeds.lastFetchedAt),
          lt(calendarFeeds.lastFetchedAt, new Date(now.getTime() - TOUCH_EVERY_MS)),
        ),
      ),
    );
}

/** The feed as the settings card shows it: the URL derived again from the row. */
export function toFeedDto(row: FeedRow, publicUrl: string, appSecret: string): CalendarFeed {
  const token = feedToken(appSecret, row.userId, row.nonce);
  const url = `${publicUrl.replace(/\/+$/, '')}/api/public/calendar/${token}/help.ics`;
  const webcalUrl = url.replace(/^https?:\/\//, 'webcal://');
  return {
    url,
    webcalUrl,
    googleUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcalUrl)}`,
    include: { events: row.includeEvents, tasks: row.includeTasks, calls: row.includeCalls },
    createdAt: row.createdAt.toISOString(),
    lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null,
  };
}
