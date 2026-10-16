import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppDeps } from '../src/deps.js';
import type { Config } from '../src/infra/config/config.js';
import type { TaskSplitProvider } from '../src/modules/ai/provider.js';
import { bulkEmailJobHandlers } from '../src/modules/bulk-email/jobs.js';
import { filesJobHandlers } from '../src/modules/files/jobs.js';
import { registerKnowledgeReminderSubject } from '../src/modules/knowledge/reminder-subject.js';
import { remindersJobHandlers } from '../src/modules/reminders/jobs.js';
import { registerTaskReminderSubject } from '../src/modules/tasks/reminder-subject.js';
import { notificationsJobHandlers } from '../src/modules/notifications/jobs.js';
import { createDb } from '../src/infra/db/client.js';
import {
  createBulkSender,
  createEmailSender,
  emailJobHandlers,
  type BulkEmailSender,
} from '../src/infra/email/index.js';
import { createInlineJobs } from '../src/infra/jobs/inline-jobs.js';
import { createDeferredQueue } from '../src/infra/jobs/jobs.js';
import { createFakePushSender, type FakePushSender } from '../src/infra/push/index.js';
import { createDiskStorage } from '../src/infra/storage/index.js';
import { testConfig } from './test-config.js';

const refuseFetch = (async () => {
  throw new Error('No live Elastic calls in tests: pass buildTestApp({ bulkFetch })');
}) as unknown as typeof fetch;

/**
 * A full app on the test database: SMTP to Mailpit (bulk email too), temp-dir storage, jobs run
 * inline, no AI unless `overrides.ai` gives a provider.
 */
export async function buildTestApp(
  overrides: {
    config?: Partial<Config>;
    ai?: TaskSplitProvider | null;
    /** The bulk sender; default: the smtp driver to Mailpit (tests of the batch job pass a fake). */
    bulkEmail?: BulkEmailSender;
    /** The fetch the bulk email jobs call Elastic with; default: refuses (no live calls in tests). */
    bulkFetch?: typeof fetch;
    /** Receives the app's info log as JSON lines (otherwise the app does not log). */
    logStream?: { write(line: string): void };
  } = {},
): Promise<{ app: FastifyInstance; deps: AppDeps; push: FakePushSender; close(): Promise<void> }> {
  const config = testConfig(overrides.config);
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const filesDir = await mkdtemp(join(tmpdir(), 'spolu-test-'));
  const email = createEmailSender(config.email);
  const storage = createDiskStorage(filesDir, config.appSecret);
  const push = createFakePushSender(
    config.push?.provider === 'fake' ? config.push.file : undefined,
  );
  const pushSender = config.push ? push : null;
  // The notification handlers send jobs (push) to the queue built from them.
  const forward = createDeferredQueue();
  registerKnowledgeReminderSubject();
  registerTaskReminderSubject();
  const bulkEmail = overrides.bulkEmail ?? createBulkSender(config.bulkEmail, config.email);
  const jobs = createInlineJobs({
    ...emailJobHandlers(email),
    ...filesJobHandlers({ db, storage }),
    ...notificationsJobHandlers(
      { db, config, push: pushSender, jobs: forward.queue },
      { scopedDelivery: true }, // test files run at once: deliver only the job's users
    ),
    ...remindersJobHandlers({ db, jobs: forward.queue }),
    ...bulkEmailJobHandlers(
      { db, config, bulkEmail, jobs: forward.queue },
      overrides.bulkFetch ?? refuseFetch,
    ),
  });
  forward.resolve(jobs);
  const deps: AppDeps = {
    config,
    db,
    email,
    bulkEmail,
    storage,
    push: pushSender,
    jobs,
    ai: overrides.ai ?? null,
  };
  // Quiet even with nodeEnv 'production', unless a test captures the log.
  const app = await buildApp(deps, { logger: false, logStream: overrides.logStream });
  return {
    app,
    deps,
    push,
    async close() {
      await closeDb();
      await rm(filesDir, { recursive: true, force: true });
    },
  };
}
