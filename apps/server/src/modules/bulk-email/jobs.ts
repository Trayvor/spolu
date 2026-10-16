import type { Config } from '../../infra/config/config.js';
import type { Db } from '../../infra/db/client.js';
import {
  createElasticSuppressions,
  type SuppressionList,
} from '../../infra/email/elastic-suppressions.js';
import type { BulkEmailSender } from '../../infra/email/bulk.js';
import type { JobHandlers, JobQueue, JobSchedule, QueueSettings } from '../../infra/jobs/jobs.js';
import { BULK_BATCH_JOB, runBatch, sweepStuck } from './batch.js';
import { bulkRealtime } from './events.js';
import { BULK_TEST_JOB, runTestSend, type BulkTestJobData } from './send.js';
import { applyProviderSuppressions } from './subscriptions.js';

/** Asks Elastic to drop the suppression of a person who subscribed again (`{ email }`). */
export const BULK_PROVIDER_RESUBSCRIBE_JOB = 'bulk-email.provider-resubscribe';
/** The daily safety net: copies Elastic's unsubscribes and complaints into Spolu. */
export const BULK_SYNC_SUPPRESSIONS_JOB = 'bulk-email.sync-suppressions';
/** The daily sweep of stuck sends (spec §4): stuck rows fail, a lost batch job is queued again. */
export const BULK_SWEEP_JOB = 'bulk-email.sweep';

const PAGE = 1000;
/** A runaway guard: a million addresses is far beyond Spolu's few thousand people. */
const MAX_PAGES = 1000;
const LISTS: SuppressionList[] = ['unsubscribes', 'complaints'];

type BulkJobDeps = { db: Db; config: Config };

/**
 * Reads Elastic's unsubscribe and complaint lists page by page and unsubscribes the matching
 * Spolu users with source `provider`, never over a newer change made in Spolu (spec §5). Only
 * with `BULK_EMAIL_DRIVER=elastic`; otherwise nothing is read. `checked` counts the addresses read.
 */
export async function syncSuppressions(
  { db, config }: BulkJobDeps,
  fetchImpl: typeof fetch = fetch,
): Promise<{ checked: number; changed: number }> {
  if (config.bulkEmail.driver !== 'elastic') return { checked: 0, changed: 0 };
  const elastic = createElasticSuppressions(config.bulkEmail.apiKey, fetchImpl);
  let checked = 0;
  let changed = 0;
  for (const kind of LISTS) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const records = await elastic.list(kind, page * PAGE, PAGE);
      checked += records.length;
      changed += await applyProviderSuppressions(db, records);
      if (records.length < PAGE) break;
    }
  }
  return { checked, changed };
}

/**
 * After a person subscribed again: in `elastic` unsubscribe mode Elastic suppressed the address
 * when its link was used, so ask it to drop that (best effort, not documented to work for
 * unsubscribes; two retries, then the failed job stays in pg-boss). Nothing in `spolu` mode.
 */
export async function queueProviderResubscribe(
  { config, jobs }: { config: Config; jobs: JobQueue },
  email: string,
): Promise<void> {
  if (config.bulkEmail.driver !== 'elastic' || config.bulkEmail.unsubscribe !== 'elastic') return;
  await jobs.send(BULK_PROVIDER_RESUBSCRIBE_JOB, { email }, { retryLimit: 2 });
}

/**
 * Job handlers of the bulk email module; passed to `startJobs`. Sending: the batch runs (which
 * reach the sockets through `attachBulkRealtime`, since jobs are built before the app), the test
 * sends and the daily sweep. Unsubscribing: the Elastic resubscribe call and suppression sync.
 */
export function bulkEmailJobHandlers(
  deps: BulkJobDeps & { bulkEmail: BulkEmailSender; jobs: JobQueue },
  fetchImpl: typeof fetch = fetch,
): JobHandlers {
  return {
    [BULK_BATCH_JOB]: async (data) =>
      void (await runBatch(
        { ...deps, io: bulkRealtime() },
        (data as { campaignId: string }).campaignId,
      )),
    [BULK_TEST_JOB]: async (data) => runTestSend(deps, data as BulkTestJobData),
    [BULK_SWEEP_JOB]: async () => sweepStuck(deps, new Date()),
    [BULK_PROVIDER_RESUBSCRIBE_JOB]: async (data) => {
      const { config } = deps;
      if (config.bulkEmail.driver !== 'elastic') return;
      const { email } = data as { email: string };
      try {
        await createElasticSuppressions(config.bulkEmail.apiKey, fetchImpl).remove(email);
      } catch (error) {
        // Logged, then thrown so pg-boss retries (the message never carries the API key).
        console.warn(`${BULK_PROVIDER_RESUBSCRIBE_JOB} failed:`, (error as Error).message);
        throw error;
      }
    },
    [BULK_SYNC_SUPPRESSIONS_JOB]: async () => {
      const { checked, changed } = await syncSuppressions(deps, fetchImpl);
      if (changed > 0) {
        console.info(
          `${BULK_SYNC_SUPPRESSIONS_JOB}: ${changed} of ${checked} addresses unsubscribed`,
        );
      }
    },
  };
}

/**
 * The sweep of stuck sends at 04:15 Bratislava time, and the suppression sync at 04:30 only
 * when bulk email goes through Elastic.
 */
export function bulkEmailSchedules(config: Config): JobSchedule[] {
  const sweep: JobSchedule = { name: BULK_SWEEP_JOB, cron: '15 4 * * *', tz: 'Europe/Bratislava' };
  return config.bulkEmail.driver === 'elastic'
    ? [sweep, { name: BULK_SYNC_SUPPRESSIONS_JOB, cron: '30 4 * * *', tz: 'Europe/Bratislava' }]
    : [sweep];
}

/**
 * One batch at a time in this process; its jobs are delayed (`startAfter`), which sends no
 * NOTIFY, so the queue polls every 2 s instead.
 */
export const bulkEmailQueues: Record<string, QueueSettings> = {
  [BULK_BATCH_JOB]: { localConcurrency: 1, notify: false, pollingIntervalSeconds: 2 },
};
