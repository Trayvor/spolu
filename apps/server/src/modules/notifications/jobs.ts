import type { PushPayload } from '@spolu/shared';
import type { JobHandlers, JobSchedule, QueueSettings } from '../../infra/jobs/jobs.js';
import { sendDueDigests } from './digest.js';
import { deliverPending, sendPush, type NotificationJobDeps } from './deliver.js';
import { deleteOldNotificationEvents, DELIVER_JOB, DIGEST_JOB, PUSH_JOB } from './service.js';

export { DELIVER_JOB, DIGEST_JOB, PUSH_JOB } from './service.js';
export const NOTIFICATIONS_PURGE_JOB = 'notifications.purge-old';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/**
 * Job handlers of the notifications module; passed to `startJobs`.
 * A deliver job delivers everyone's pending events: its queue is stately, so a burst of requests
 * coalesces into one job and the `userIds` of the others are not in its data.
 * `scopedDelivery` (tests only, with the inline queue): a deliver job delivers only the `userIds`
 * in its data, so test files running at once do not deliver each other's events.
 */
export function notificationsJobHandlers(
  deps: NotificationJobDeps,
  opts: { scopedDelivery?: boolean } = {},
): JobHandlers {
  return {
    [DELIVER_JOB]: async (data) => {
      const { userIds } = data as { userIds?: unknown };
      const scoped = opts.scopedDelivery && isStringArray(userIds);
      await deliverPending(deps, scoped ? { userIds } : {});
    },
    // `{ userIds }` ten minutes after a delivery; `{}` from the sweep emails every due digest.
    [DIGEST_JOB]: async (data) => {
      const { userIds } = data as { userIds?: unknown };
      await sendDueDigests(deps, isStringArray(userIds) ? { userIds } : {});
    },
    [PUSH_JOB]: (data) => sendPush(deps, data as { subscriptionId: string; payload: PushPayload }),
    [NOTIFICATIONS_PURGE_JOB]: async () =>
      void (await deleteOldNotificationEvents(deps.db, new Date(Date.now() - KEEP_MS))),
  };
}

/**
 * Deliver is stately (at most one queued and one active: requests after a write coalesce, and
 * the global sweep with `SKIP LOCKED` delivers everything). Push sends run 8 at once with a
 * short poll: one job per device, each a network round trip to the push service.
 */
export const notificationQueues: Record<string, QueueSettings> = {
  [DELIVER_JOB]: { policy: 'stately' },
  [PUSH_JOB]: { localConcurrency: 8, pollingIntervalSeconds: 0.5 },
};

/** The delivery sweep every minute (picks up what a crash left behind) and the daily purge. */
export const notificationSchedules: JobSchedule[] = [
  { name: DELIVER_JOB, cron: '* * * * *' },
  { name: DIGEST_JOB, cron: '* * * * *' },
  { name: NOTIFICATIONS_PURGE_JOB, cron: '45 3 * * *' }, // daily, 03:45
];
