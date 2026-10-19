import type { Db } from '../../infra/db/client.js';
import type { JobHandlers } from '../../infra/jobs/jobs.js';
import { deleteOldAudit } from './retention.js';

export const AUDIT_CLEANUP_JOB = 'audit.cleanup';

/** Job handlers of the audit module; passed to `startJobs`. */
export function auditJobHandlers(db: Db): JobHandlers {
  return {
    // Daily: rows older than 730 days, in batches of 5 000.
    [AUDIT_CLEANUP_JOB]: async () => void (await deleteOldAudit(db)),
  };
}
