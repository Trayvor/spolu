import type { JobHandlers } from '../../infra/jobs/jobs.js';
import { deleteUnattachedFiles, type FileDeps } from './service.js';

export const FILES_CLEANUP_JOB = 'files.cleanup-unattached';
const KEEP_MS = 24 * 60 * 60 * 1000;

/** Job handlers of the files module; passed to `startJobs`. */
export function filesJobHandlers(deps: FileDeps): JobHandlers {
  return {
    [FILES_CLEANUP_JOB]: async () =>
      void (await deleteUnattachedFiles(deps, new Date(Date.now() - KEEP_MS))),
  };
}
