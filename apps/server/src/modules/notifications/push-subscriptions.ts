import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { pushSubscriptions } from './schema.js';

export type PushSubscriptionRow = typeof pushSubscriptions.$inferSelect;

/**
 * Stores a device subscription. An endpoint belongs to one browser, so when another user saves
 * the same endpoint (shared device, new login) it moves to that user.
 */
export async function saveSubscription(
  db: Db,
  userId: string,
  s: { endpoint: string; p256dh: string; auth: string; userAgent: string | null },
): Promise<void> {
  await db
    .insert(pushSubscriptions)
    .values({ id: randomUUID(), userId, ...s })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { userId, p256dh: s.p256dh, auth: s.auth, userAgent: s.userAgent },
    });
}

/** Deletes the subscription only when it belongs to `userId`. */
export async function deleteOwnSubscription(
  db: Db,
  userId: string,
  endpoint: string,
): Promise<void> {
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/** Subscriptions of the given users, keyed by user id; users without one are absent. */
export async function listSubscriptions(
  db: Db,
  userIds: string[],
): Promise<Map<string, PushSubscriptionRow[]>> {
  const result = new Map<string, PushSubscriptionRow[]>();
  if (userIds.length === 0) return result;
  const rows = await db
    .select()
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, [...new Set(userIds)]));
  for (const row of rows) {
    const list = result.get(row.userId);
    if (list) list.push(row);
    else result.set(row.userId, [row]);
  }
  return result;
}

export async function getSubscription(db: Db, id: string): Promise<PushSubscriptionRow | null> {
  const [row] = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.id, id));
  return row ?? null;
}

export async function deleteSubscriptionById(db: Db, id: string): Promise<void> {
  await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, id));
}

export async function markPushSuccess(db: Db, id: string): Promise<void> {
  await db
    .update(pushSubscriptions)
    .set({ lastSuccessAt: new Date() })
    .where(eq(pushSubscriptions.id, id));
}
