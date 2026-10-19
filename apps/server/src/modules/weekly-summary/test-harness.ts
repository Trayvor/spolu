import type { Db } from '../../infra/db/client.js';
import { emailJobHandlers } from '../../infra/email/index.js';
import { createInlineJobs } from '../../infra/jobs/inline-jobs.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { createCapturingEmailSender } from '../../../test/mail.js';
import { testConfig } from '../../../test/test-config.js';
import type { WeeklySummaryProvider } from '../ai/weekly-summary.js';
import { weeklySummaryJobHandlers, type WeeklySummaryDeps } from './jobs.js';
import { socketSpy } from './test-fixtures.js';

/**
 * Test-only: the module's jobs run inline (email captured in `test/mail.ts`), with a socket spy
 * and a log of every job sent.
 */
export function weeklyHarness(
  db: Db,
  opts: { ai?: WeeklySummaryProvider | null; aiTimeoutMs?: number } = {},
) {
  const { io, emitted } = socketSpy();
  const sent: { name: string; data: object }[] = [];
  const deps: WeeklySummaryDeps = {
    db,
    config: testConfig(),
    jobs: null as unknown as JobQueue,
    ai: opts.ai ?? null,
    aiTimeoutMs: opts.aiTimeoutMs,
    io,
  };
  const inline = createInlineJobs({
    ...emailJobHandlers(createCapturingEmailSender()),
    ...weeklySummaryJobHandlers(deps),
  });
  const jobs: JobQueue = {
    async send(name, data, options) {
      sent.push({ name, data });
      await inline.send(name, data, options);
    },
    async sendMany(name, items) {
      for (const data of items) await jobs.send(name, data);
    },
  };
  deps.jobs = jobs;
  return { deps, emitted, sent };
}
