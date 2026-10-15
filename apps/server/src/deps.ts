import type { Config } from './infra/config/config.js';
import { createDb, type Db } from './infra/db/client.js';
import { createEmailSender, emailJobHandlers, type EmailSender } from './infra/email/index.js';
import { startJobs, type JobQueue } from './infra/jobs/jobs.js';
import { createDiskStorage, type Storage } from './infra/storage/index.js';

/** Everything a module needs from the outside world; every module plugin receives this. */
export type AppDeps = {
  config: Config;
  db: Db;
  email: EmailSender;
  storage: Storage;
  jobs: JobQueue;
};

/** Creates the real dependencies. `close` stops the jobs, then the database. */
export async function createDeps(
  config: Config,
): Promise<{ deps: AppDeps; close(): Promise<void> }> {
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const email = createEmailSender(config.email);
  const storage = createDiskStorage(config.filesDir, config.appSecret);
  const jobs = await startJobs(config.databaseUrl, emailJobHandlers(email));
  return {
    deps: { config, db, email, storage, jobs: jobs.queue },
    async close() {
      await jobs.stop();
      await closeDb();
    },
  };
}
