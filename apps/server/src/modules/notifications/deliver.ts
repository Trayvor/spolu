import { and, asc, inArray, isNull, sql } from 'drizzle-orm';
import { wantsEmail, wantsPush, type NotificationKind, type PushPayload } from '@spolu/shared';
import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import type { JobOptions, JobQueue } from '../../infra/jobs/jobs.js';
import type { PushSender } from '../../infra/push/index.js';
import { unreadForNotify } from '../chat/notify.js';
import { groups } from '../groups/schema.js';
import { getTaskTitles } from '../tasks/task-service.js';
import { financeHoldersAmong, getNotificationProfiles } from '../users/service.js';
import { audienceAmong, notificationGroupOf } from './categories.js';
import { decideEvent, isOutranked, KIND_RANK } from './decide.js';
import { getEffectiveModes } from './modes.js';
import { buildPushPayload } from './push-content.js';
import {
  deleteSubscriptionById,
  getSubscription,
  listSubscriptions,
  markPushSuccess,
} from './push-subscriptions.js';
import { notificationEvents } from './schema.js';
import { DIGEST_JOB, PUSH_JOB } from './service.js';

export type NotificationJobDeps = {
  db: Db;
  config: Config;
  push: PushSender | null;
  jobs: JobQueue;
};

const BATCH_SIZE = 200;
/**
 * One job per device: three retries 30 s apart, then the job is gone after an hour. A run longer
 * than 30 s (the send itself times out after 10 s) counts as failed and is retried.
 */
export const PUSH_JOB_OPTIONS: JobOptions = {
  expireInSeconds: 30,
  retryLimit: 3,
  retryDelay: 30,
  deleteAfterSeconds: 3600,
};

type EventRow = typeof notificationEvents.$inferSelect;
type PushJob = { subscriptionId: string; payload: PushPayload };

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const payloadOf = (row: EventRow) => (row.payload ?? {}) as Record<string, unknown>;
const unique = <T>(items: T[]): T[] => [...new Set(items)];

/**
 * Delivers undelivered events, oldest first, in batches of `limit` (scoped to `userIds` and to
 * `eventIds` when given) until a batch comes back short; returns how many events it processed. Each batch is one
 * transaction: the rows are locked with `FOR UPDATE SKIP LOCKED`, so concurrent workers take
 * disjoint rows and no event is delivered twice; every locked row gets `delivered_at` (and
 * `email_due_at` when it qualifies for the email batch). Push jobs are sent after the commit.
 */
export async function deliverPending(
  deps: NotificationJobDeps,
  opts: { userIds?: string[]; eventIds?: string[]; limit?: number } = {},
): Promise<number> {
  const limit = opts.limit ?? BATCH_SIZE;
  if (opts.userIds?.length === 0 || opts.eventIds?.length === 0) return 0;
  const scope = { userIds: opts.userIds, eventIds: opts.eventIds };
  let total = 0;
  for (;;) {
    const { count, pushes, emailUserIds } = await deps.db.transaction((tx) =>
      deliverBatch(tx, deps, scope, limit),
    );
    total += count;
    await queuePushes(deps.jobs, pushes);
    if (emailUserIds.length > 0) {
      try {
        await deps.jobs.send(
          DIGEST_JOB,
          { userIds: emailUserIds },
          { startAfter: Math.ceil(deps.config.emailBatchDelayMs / 1000) },
        );
      } catch (error) {
        // The one-minute sweep emails the due digests anyway.
        console.error('notifications: digest job could not be queued (the sweep sends it)', error);
      }
    }
    if (count < limit) return total;
  }
}

/**
 * Queues the batch's push jobs in one insert (Phase 27 S7). If that fails, or the queue has no
 * `sendMany`, one by one: the events are already delivered, so one lost push must not stop the
 * others.
 */
async function queuePushes(jobs: JobQueue, pushes: PushJob[]): Promise<void> {
  if (pushes.length === 0) return;
  if (jobs.sendMany) {
    try {
      await jobs.sendMany(PUSH_JOB, pushes, PUSH_JOB_OPTIONS);
      return;
    } catch (error) {
      console.error('notifications: push jobs could not be queued together; one by one', error);
    }
  }
  for (const job of pushes) {
    try {
      await jobs.send(PUSH_JOB, job, PUSH_JOB_OPTIONS);
    } catch (error) {
      console.error('notifications: push job could not be queued', error);
    }
  }
}

async function deliverBatch(
  tx: Db,
  deps: NotificationJobDeps,
  scope: { userIds?: string[]; eventIds?: string[] },
  limit: number,
): Promise<{ count: number; pushes: PushJob[]; emailUserIds: string[] }> {
  const { userIds, eventIds } = scope;
  const rows = await tx
    .select()
    .from(notificationEvents)
    .where(
      and(
        isNull(notificationEvents.deliveredAt),
        userIds ? inArray(notificationEvents.userId, unique(userIds)) : undefined,
        eventIds ? inArray(notificationEvents.id, unique(eventIds)) : undefined,
      ),
    )
    .orderBy(asc(notificationEvents.createdAt), asc(notificationEvents.id))
    .limit(limit)
    .for('update', { skipLocked: true });
  if (rows.length === 0) return { count: 0, pushes: [], emailUserIds: [] };

  const { pushes, emailIds } = await decideBatch(tx, deps, rows);
  const email = new Set(emailIds);
  const plainIds = rows.map((r) => r.id).filter((id) => !email.has(id));
  // now() is the transaction's start time, so both statements stamp the same instant.
  if (emailIds.length > 0) {
    await tx
      .update(notificationEvents)
      .set({
        deliveredAt: sql`now()`,
        emailDueAt: sql`now() + ${deps.config.emailBatchDelayMs}::int * interval '1 millisecond'`,
      })
      .where(inArray(notificationEvents.id, emailIds));
  }
  if (plainIds.length > 0) {
    await tx
      .update(notificationEvents)
      .set({ deliveredAt: sql`now()` })
      .where(inArray(notificationEvents.id, plainIds));
  }
  const emailUserIds = unique(rows.filter((r) => email.has(r.id)).map((r) => r.userId));
  return { count: rows.length, pushes, emailUserIds };
}

/**
 * Loads the batch's context in bulk and decides every event. Events whose user could get neither
 * a push nor an email by the event group's channel (no profile, disabled, none, push without a
 * device) are decided without loading the rest, which is most events of most batches.
 */
async function decideBatch(
  tx: Db,
  deps: NotificationJobDeps,
  batch: EventRow[],
): Promise<{ pushes: PushJob[]; emailIds: string[] }> {
  const userIds = unique(batch.map((r) => r.userId));
  const profiles = await getNotificationProfiles(tx, userIds);
  const subscriptions = await listSubscriptions(tx, userIds);
  const groupOf = new Map(batch.map((r) => [r.id, notificationGroupOf(r.kind, payloadOf(r))]));
  const rows = batch.filter((r) => {
    const group = groupOf.get(r.id) ?? null;
    // Only a ticket event (item B: `ticket.unassigned` goes to admins) or a finance event of the
    // organisation (Phase 32 E: an expense's reminder) may lack a client group; for any other
    // group that is a bug upstream, not a user setting.
    if (group === null || (r.groupId === null && group !== 'tickets' && group !== 'finance')) {
      console.warn(`notifications: event ${r.id} (${r.kind}) has no group or an unknown kind`);
      return false;
    }
    const profile = profiles.get(r.userId);
    if (!profile || profile.disabled) return false;
    const channel = profile.channels[group];
    const canPush = wantsPush(channel) && deps.push !== null && subscriptions.has(r.userId);
    return canPush || wantsEmail(channel);
  });
  if (rows.length === 0) return { pushes: [], emailIds: [] };

  const grouped = rows.filter((r) => r.groupId !== null);
  const groupIds = unique(grouped.map((r) => r.groupId!));
  const messagePairs = rows.flatMap((r) => {
    const messageId = str(payloadOf(r).messageId);
    return messageId ? [{ userId: r.userId, messageId }] : [];
  });
  const taskIds = unique(rows.flatMap((r) => str(payloadOf(r).taskId) ?? []));

  const modes = await getEffectiveModes(
    tx,
    grouped.map((r) => ({ userId: r.userId, groupId: r.groupId! })),
    profiles,
  );
  // Membership as of now: someone removed after the event gets nothing. One query per batch.
  const inAudience = await audienceAmong(
    tx,
    grouped.map((r) => ({ userId: r.userId, groupId: r.groupId!, group: groupOf.get(r.id)! })),
  );
  // A finance event of no client (Phase 32 E) re-checks the right at send time, as
  // `audienceAmong` does for a client's: someone who lost it meanwhile gets nothing.
  const orgFinanceHolders = await financeHoldersAmong(
    tx,
    unique(
      rows
        .filter((r) => r.groupId === null && groupOf.get(r.id) === 'finance')
        .map((r) => r.userId),
    ),
  );
  const groupNames = new Map(
    (
      await tx
        .select({ id: groups.id, name: groups.name })
        .from(groups)
        .where(inArray(groups.id, groupIds))
    ).map((g) => [g.id, g.name]),
  );
  const unread = await unreadForNotify(tx, messagePairs);
  const siblings = await loadSiblings(tx, rows);
  const taskTitles = await getTaskTitles(tx, taskIds);

  const pushes: PushJob[] = [];
  const emailIds: string[] = [];
  for (const row of rows) {
    const profile = profiles.get(row.userId)!;
    const groupId = row.groupId;
    const kind = row.kind as NotificationKind;
    const p = payloadOf(row);
    const messageId = str(p.messageId);
    const key = `${row.userId}:${messageId}`;
    const message = messageId ? unread.get(key) : undefined;
    const subs = subscriptions.get(row.userId) ?? [];
    const decision = decideEvent({
      kind,
      mode: modes.get(`${row.userId}:${groupId}`) ?? 'off',
      // A ticket event without a client group: its recorder chose the recipients; a finance event
      // of the organisation: the finance admins among them.
      isGroupPerson:
        groupId === null
          ? groupOf.get(row.id) !== 'finance' || orgFinanceHolders.has(row.userId)
          : inAudience(row.userId, groupId, groupOf.get(row.id)!),
      // Task events have no message to read; chat events need theirs still unread.
      unread: messageId === null || message !== undefined,
      outranked: messageId !== null && isOutranked({ id: row.id, kind }, siblings.get(key) ?? []),
      group: groupOf.get(row.id)!,
      channel: profile.channels[groupOf.get(row.id)!],
      pushAvailable: deps.push !== null,
      hasSubscriptions: subs.length > 0,
    });
    if (decision.email) emailIds.push(row.id);
    if (!decision.push) continue;
    const taskId = str(p.taskId);
    const payload = buildPushPayload({
      kind,
      payload: p,
      groupName: (groupId && groupNames.get(groupId)) ?? '',
      taskTitle: taskId ? (taskTitles.get(taskId) ?? null) : null,
      parentId: message?.parentId ?? null,
      lang: profile.language,
      now: new Date(),
    });
    for (const sub of subs) pushes.push({ subscriptionId: sub.id, payload });
  }
  return { pushes, emailIds };
}

/**
 * Every event of the same user and message, delivered or not, read without locks: a sibling in
 * another batch (or another worker's) still outranks a weaker event, so a message makes one push.
 * A message's events are recorded in one transaction and share its `created_at`, so the lookup
 * goes through the `created_at` index instead of all of a user's events.
 */
async function loadSiblings(
  tx: Db,
  rows: EventRow[],
): Promise<Map<string, { id: string; kind: NotificationKind }[]>> {
  const result = new Map<string, { id: string; kind: NotificationKind }[]>();
  const chat = rows.filter((r) => str(payloadOf(r).messageId) !== null);
  if (chat.length === 0) return result;
  const messageId = sql<string>`${notificationEvents.payload}->>'messageId'`;
  // The batch's instants, read in SQL (a JS Date would drop the microseconds); `= any(array(…))`
  // keeps the plan on the created_at index.
  const instants = tx
    .selectDistinct({ at: notificationEvents.createdAt })
    .from(notificationEvents)
    .where(
      inArray(
        notificationEvents.id,
        chat.map((r) => r.id),
      ),
    );
  const found = await tx
    .select({
      id: notificationEvents.id,
      userId: notificationEvents.userId,
      kind: notificationEvents.kind,
      messageId,
    })
    .from(notificationEvents)
    .where(
      and(
        sql`${notificationEvents.createdAt} = any(array(${instants}))`,
        inArray(notificationEvents.userId, unique(chat.map((r) => r.userId))),
        inArray(messageId, unique(chat.map((r) => str(payloadOf(r).messageId)!))),
      ),
    );
  for (const r of found) {
    if (!(r.kind in KIND_RANK)) continue;
    const key = `${r.userId}:${r.messageId}`;
    const list = result.get(key) ?? [];
    list.push({ id: r.id, kind: r.kind as NotificationKind });
    result.set(key, list);
  }
  return result;
}

/**
 * Sends one push. A missing subscription is a no-op, 'gone' (404/410) deletes it, a success marks
 * it; any other failure is logged and rethrown so pg-boss retries the job.
 */
export async function sendPush(
  deps: Pick<NotificationJobDeps, 'db' | 'push'>,
  data: PushJob,
): Promise<void> {
  if (!deps.push) return;
  const sub = await getSubscription(deps.db, data.subscriptionId);
  if (!sub) return;
  let outcome: 'sent' | 'gone';
  try {
    outcome = await deps.push.send(
      { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
      data.payload,
    );
  } catch (error) {
    console.error(`notifications: push to subscription ${sub.id} failed`, error);
    throw error;
  }
  if (outcome === 'gone') await deleteSubscriptionById(deps.db, sub.id);
  else await markPushSuccess(deps.db, sub.id);
}
