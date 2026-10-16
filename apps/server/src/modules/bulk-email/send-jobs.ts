import type { AppDeps } from '../../deps.js';
import type { JobHandlers, JobSchedule, QueueSettings } from '../../infra/jobs/jobs.js';
import { BULK_BATCH_JOB, runBatch, sweepStuck } from './batch.js';
import { bulkRealtime } from './events.js';
import { BULK_TEST_JOB, runTestSend, type BulkTestJobData } from './send.js';

/** The daily sweep of stuck sends (spec §4), 04:15 Bratislava time. */
export const BULK_SWEEP_JOB = 'bulk-email.sweep';

/**
 * The sending jobs of bulk email: the batch runs, the test sends and the daily sweep. The batch
 * job reaches the sockets through `attachBulkRealtime` (jobs are built before the app).
 */
export function bulkSendJobHandlers(
  deps: Pick<AppDeps, 'db' | 'config' | 'bulkEmail' | 'jobs'>,
): JobHandlers {
  return {
    [BULK_BATCH_JOB]: async (data) =>
      void (await runBatch(
        { ...deps, io: bulkRealtime() },
        (data as { campaignId: string }).campaignId,
      )),
    [BULK_TEST_JOB]: async (data) => runTestSend(deps, data as BulkTestJobData),
    [BULK_SWEEP_JOB]: async () => sweepStuck(deps, new Date()),
  };
}

/**
 * One batch at a time in this process; its jobs are delayed (`startAfter`), which sends no
 * NOTIFY, so the queue polls every 2 s instead.
 */
export const bulkSendQueues: Record<string, QueueSettings> = {
  [BULK_BATCH_JOB]: { localConcurrency: 1, notify: false, pollingIntervalSeconds: 2 },
};

export const bulkSendSchedules: JobSchedule[] = [
  { name: BULK_SWEEP_JOB, cron: '15 4 * * *', tz: 'Europe/Bratislava' },
];
