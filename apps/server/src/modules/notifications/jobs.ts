import type { PushPayload } from '@spolu/shared';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { sendDueDigests } from './digest.js';
import { deliverPending, sendPush, type NotificationJobDeps } from './deliver.js';
import { deleteOldNotificationEvents, DELIVER_JOB, DIGEST_JOB, PUSH_JOB } from './service.js';

export { DELIVER_JOB, DIGEST_JOB, PUSH_JOB } from './service.js';
export const NOTIFICATIONS_PURGE_JOB = 'notifications.purge-old';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Job handlers of the notifications module; passed to `startJobs`. */
export function notificationsJobHandlers(deps: NotificationJobDeps): JobHandlers {
  return {
    // `{ userIds }` after a write; `{}` from the one-minute sweep delivers everyone's leftovers.
    [DELIVER_JOB]: async (data) => {
      const { userIds } = data as { userIds?: unknown };
      await deliverPending(deps, isStringArray(userIds) ? { userIds } : {});
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

/** The delivery sweep every minute (picks up what a crash left behind) and the daily purge. */
export const notificationSchedules: JobSchedule[] = [
  { name: DELIVER_JOB, cron: '* * * * *' },
  { name: DIGEST_JOB, cron: '* * * * *' },
  { name: NOTIFICATIONS_PURGE_JOB, cron: '45 3 * * *' }, // daily, 03:45
];
