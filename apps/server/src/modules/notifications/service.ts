import { randomUUID } from 'node:crypto';
import { lt } from 'drizzle-orm';
import type { NotificationKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { notificationEvents } from './schema.js';

/**
 * Records one event per unique recipient in a single insert. Call it inside the caller's
 * transaction so the events roll back with the change. The caller decides who is a recipient
 * (the actor is not dropped here). With `dedupeKey` an event is recorded at most once per user and
 * key. Returns the user ids an event was recorded for.
 */
export async function recordNotifications(
  tx: Db,
  input: {
    kind: NotificationKind;
    groupId: string | null;
    recipients: string[];
    payload: Record<string, unknown>;
    dedupeKey?: string;
  },
): Promise<string[]> {
  const recipients = [...new Set(input.recipients)];
  if (recipients.length === 0) return [];
  const inserted = await tx
    .insert(notificationEvents)
    .values(
      recipients.map((userId) => ({
        id: randomUUID(),
        userId,
        groupId: input.groupId,
        kind: input.kind,
        payload: input.payload,
        dedupeKey: input.dedupeKey ?? null,
      })),
    )
    .onConflictDoNothing()
    .returning({ userId: notificationEvents.userId });
  return inserted.map((row) => row.userId);
}

/** Asks the delivery job to deliver the pending events of `userIds`; a failure is only logged. */
export async function requestDelivery(jobs: JobQueue, userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  try {
    await jobs.send('notifications.deliver', { userIds });
  } catch (error) {
    console.error('requestDelivery failed:', error);
  }
}

/** Deletes events created before `olderThan`; returns how many. */
export async function deleteOldNotificationEvents(db: Db, olderThan: Date): Promise<number> {
  const removed = await db
    .delete(notificationEvents)
    .where(lt(notificationEvents.createdAt, olderThan))
    .returning({ id: notificationEvents.id });
  return removed.length;
}
