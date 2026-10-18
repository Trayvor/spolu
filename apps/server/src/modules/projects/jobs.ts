import { EGRANT_PROJECT_LIMITS } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { JobHandlers } from '../../infra/jobs/jobs.js';
import { dropOldInboxDeliveries } from './egrant-delivery.js';

/** Daily: eGrant deliveries stored for an instance no client has, older than 180 days, go. */
export const PROJECTS_INBOX_CLEANUP_JOB = 'projects.egrant-inbox-cleanup';
const KEEP_MS = EGRANT_PROJECT_LIMITS.inboxDays * 24 * 60 * 60 * 1000;

/** Job handlers of the projects module; passed to `startJobs`. */
export function projectsJobHandlers(deps: { db: Db }): JobHandlers {
  return {
    [PROJECTS_INBOX_CLEANUP_JOB]: async () =>
      void (await dropOldInboxDeliveries(deps.db, new Date(Date.now() - KEEP_MS))),
  };
}
