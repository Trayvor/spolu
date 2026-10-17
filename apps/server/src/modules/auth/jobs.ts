import type { Db } from '../../infra/db/client.js';
import type { JobHandlers } from '../../infra/jobs/jobs.js';
import { deleteExpiredVerifications } from './service.js';
import { deleteExpiredTicketLinks } from './ticket-link.js';

export const AUTH_CLEANUP_JOB = 'auth.cleanup-verifications';

/** Job handlers of the auth module; passed to `startJobs`. */
export function authJobHandlers(db: Db): JobHandlers {
  return {
    // Daily: expired login codes and expired ticket sign-in links.
    [AUTH_CLEANUP_JOB]: async () => {
      await deleteExpiredVerifications(db);
      await deleteExpiredTicketLinks(db);
    },
  };
}
