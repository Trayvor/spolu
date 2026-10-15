import { randomUUID } from 'node:crypto';
import { lt } from 'drizzle-orm';
import type { NotificationKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { notificationEvents } from './schema.js';

/**
 * Records one event per unique recipient in a single insert. Call it inside the caller's
 * transaction so the events roll back with the change. The caller decides who is a recipient
 * (the actor is not dropped here).
 */
export async function recordNotifications(
  tx: Db,
  input: {
    kind: NotificationKind;
    groupId: string | null;
    recipients: string[];
    payload: Record<string, unknown>;
  },
): Promise<void> {
  const recipients = [...new Set(input.recipients)];
  if (recipients.length === 0) return;
  await tx.insert(notificationEvents).values(
    recipients.map((userId) => ({
      id: randomUUID(),
      userId,
      groupId: input.groupId,
      kind: input.kind,
      payload: input.payload,
    })),
  );
}

/** Deletes events created before `olderThan`; returns how many. */
export async function deleteOldNotificationEvents(db: Db, olderThan: Date): Promise<number> {
  const removed = await db
    .delete(notificationEvents)
    .where(lt(notificationEvents.createdAt, olderThan))
    .returning({ id: notificationEvents.id });
  return removed.length;
}
