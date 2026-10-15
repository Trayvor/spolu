import type { Db } from '../../infra/db/client.js';
import type { JobHandlers } from '../../infra/jobs/jobs.js';
import { deleteOldNotificationEvents } from './service.js';

export const NOTIFICATIONS_PURGE_JOB = 'notifications.purge-old';
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

/** Job handlers of the notifications module; passed to `startJobs`. */
export function notificationsJobHandlers(db: Db): JobHandlers {
  return {
    [NOTIFICATIONS_PURGE_JOB]: async () =>
      void (await deleteOldNotificationEvents(db, new Date(Date.now() - KEEP_MS))),
  };
}
