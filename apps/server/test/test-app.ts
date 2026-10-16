import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import type { AppDeps } from '../src/deps.js';
import type { Config } from '../src/infra/config/config.js';
import { filesJobHandlers } from '../src/modules/files/jobs.js';
import { notificationsJobHandlers } from '../src/modules/notifications/jobs.js';
import { createDb } from '../src/infra/db/client.js';
import { createEmailSender, emailJobHandlers } from '../src/infra/email/index.js';
import { createInlineJobs } from '../src/infra/jobs/inline-jobs.js';
import { createDeferredQueue } from '../src/infra/jobs/jobs.js';
import { createFakePushSender, type FakePushSender } from '../src/infra/push/index.js';
import { createDiskStorage } from '../src/infra/storage/index.js';
import { testConfig } from './test-config.js';

/** A full app on the test database: SMTP to Mailpit, temp-dir storage, jobs run inline. */
export async function buildTestApp(overrides: { config?: Partial<Config> } = {}): Promise<{
  app: FastifyInstance;
  deps: AppDeps;
  push: FakePushSender;
  close(): Promise<void>;
}> {
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
  const jobs = createInlineJobs({
    ...emailJobHandlers(email),
    ...filesJobHandlers({ db, storage }),
    ...notificationsJobHandlers(
      { db, config, push: pushSender, jobs: forward.queue },
      { scopedDelivery: true }, // test files run at once: deliver only the job's users
    ),
  });
  forward.resolve(jobs);
  const deps: AppDeps = { config, db, email, storage, push: pushSender, jobs };
  const app = await buildApp(deps, { logger: false }); // quiet even with nodeEnv 'production'
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
