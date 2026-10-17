import { randomUUID } from 'node:crypto';
import { lt, sql, type SQL } from 'drizzle-orm';
import type { NotificationCategory, NotificationKind } from '@spolu/shared';
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
export async function recordNotifications(tx: Db, input: NotificationInput): Promise<string[]> {
  return recordManyNotifications(tx, [input]);
}

const INSERT_CHUNK = 1000;

/** What `recordNotifications` records: one event of `kind` for each of `recipients`. */
export type NotificationInput = {
  kind: NotificationKind;
  groupId: string | null;
  recipients: string[];
  payload: Record<string, unknown>;
  dedupeKey?: string;
};

/**
 * `recordNotifications` for many inputs at once (a job's batch: one event per task or reminder
 * time): one `INSERT … SELECT` per notification group among the inputs, however many inputs.
 * Same rules per input: recipients deduplicated, `dedupeKey` skips a recipient who has it,
 * the pending state from the channel of the input's group. Returns the recorded event ids.
 */
export async function recordManyNotifications(
  tx: Db,
  inputs: NotificationInput[],
): Promise<string[]> {
  // The delivered_at rule depends on the notification group, so each group is one statement.
  const byGroup = new Map<NotificationCategory | null, SQL[]>();
  for (const input of inputs) {
    const group = notificationGroupOf(input.kind, input.payload);
    const rows = byGroup.get(group) ?? [];
    const payload = JSON.stringify(input.payload);
    for (const userId of new Set(input.recipients)) {
      rows.push(
        sql`(${randomUUID()}::text, ${userId}::text, ${input.groupId}::text, ${input.kind}::text, ${payload}::jsonb, ${input.dedupeKey ?? null}::text)`,
      );
    }
    byGroup.set(group, rows);
  }
  const ids: string[] = [];
  for (const [group, all] of byGroup) {
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
    // Chunks keep a statement well under PostgreSQL's 65 535 bind parameters (6 per row).
    for (let i = 0; i < all.length; i += INSERT_CHUNK) {
      const rows = all.slice(i, i + INSERT_CHUNK);
      const recorded = await tx.execute<{ id: string }>(sql`
        insert into notification_events
          (id, user_id, group_id, kind, payload, dedupe_key, delivered_at)
        select v.id, v.user_id, v.group_id, v.kind, v.payload, v.dedupe_key, ${deliveredAt}
        from (values ${sql.join(rows, sql`, `)}) as v(id, user_id, group_id, kind, payload, dedupe_key)
        join "user" u on u.id = v.user_id
        on conflict do nothing
        returning id
      `);
      for (const r of recorded) ids.push(r.id);
    }
  }
  return ids;
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
