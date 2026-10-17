import { randomUUID } from 'node:crypto';
import { lt, sql } from 'drizzle-orm';
import type { NotificationKind } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { channelSql } from '../users/service.js';
import { notificationGroupOf } from './categories.js';
import { notificationEvents } from './schema.js';

/** Delivers everyone's pending events; a stately queue, so requests coalesce (see `notificationQueues`). */
export const DELIVER_JOB = 'notifications.deliver';
/** Emails the due digests of `{ userIds }`, or of everyone (the one-minute sweep, `{}`). */
export const DIGEST_JOB = 'notifications.email-digest';
/** Sends one push to one device: `{ subscriptionId, payload }`. */
export const PUSH_JOB = 'notifications.push';

/**
 * Records one event per unique recipient in a single statement. Call it inside the caller's
 * transaction so the events roll back with the change, and call `requestDelivery` with the
 * returned recipients after the commit. The caller decides who is a recipient (the actor is not
 * dropped here). With `dedupeKey`, a recipient who already has an event with that key is skipped.
 * All events of one message must be recorded in one transaction (delivery finds a message's
 * events by their shared `created_at`).
 *
 * A recipient who can get neither a push nor an email by the channel of the event's notification
 * group (disabled; none; push without a device; a kind with no group) gets the event already
 * delivered: the delivery decision would be "nothing" anyway, and
 * most recipients of a message (every admin is in every group) are like this, so the worker only
 * touches the events that may send something. Returns the ids of the events recorded (one per
 * recipient an event was recorded for), for `requestDelivery`.
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
  const values = sql.join(
    recipients.map((userId) => sql`(${randomUUID()}::text, ${userId}::text)`),
    sql`, `,
  );
  const group = notificationGroupOf(input.kind, input.payload);
  const deliveredAt =
    group === null
      ? sql`now()`
      : sql`case
        when u.disabled_at is not null then now()
        when ${channelSql('u', group)} in ('email', 'both') then null
        when ${channelSql('u', group)} = 'push'
          and exists (select 1 from push_subscriptions s where s.user_id = u.id) then null
        else now()
      end`;
  const rows = await tx.execute<{ id: string }>(sql`
    insert into notification_events
      (id, user_id, group_id, kind, payload, dedupe_key, delivered_at)
    select v.id, v.user_id, ${input.groupId}::text, ${input.kind}::text,
      ${JSON.stringify(input.payload)}::jsonb, ${input.dedupeKey ?? null}::text,
      ${deliveredAt}
    from (values ${values}) as v(id, user_id)
    join "user" u on u.id = v.user_id
    on conflict do nothing
    returning id
  `);
  return [...rows].map((r) => r.id);
}

/**
 * Asks for delivery of the recorded events (`recordNotifications`' ids); call it after the
 * events committed. Never throws: a failed send is logged and the one-minute sweep delivers the
 * events instead. The deliver queue keeps one job waiting, so a request while one waits is
 * dropped and the waiting job delivers these events too. `eventIds` go in the data only for the
 * tests' scoped delivery (see `notificationsJobHandlers`); production delivers every pending event.
 */
export async function requestDelivery(jobs: JobQueue, eventIds: string[]): Promise<void> {
  const unique = [...new Set(eventIds)];
  if (unique.length === 0) return;
  try {
    await jobs.send(DELIVER_JOB, { eventIds: unique });
  } catch (error) {
    console.error('notifications: delivery request failed (the sweep retries)', error);
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
