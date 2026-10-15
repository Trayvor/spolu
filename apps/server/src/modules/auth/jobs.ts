import type { Db } from '../../infra/db/client.js';
import type { JobHandlers } from '../../infra/jobs/jobs.js';
import { deleteExpiredVerifications } from './service.js';

export const AUTH_CLEANUP_JOB = 'auth.cleanup-verifications';

/** Job handlers of the auth module; passed to `startJobs`. */
export function authJobHandlers(db: Db): JobHandlers {
  return { [AUTH_CLEANUP_JOB]: async () => void (await deleteExpiredVerifications(db)) };
}
