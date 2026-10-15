import type { Config } from './infra/config/config.js';
import { authJobHandlers, AUTH_CLEANUP_JOB } from './modules/auth/jobs.js';
import { filesJobHandlers, FILES_CLEANUP_JOB } from './modules/files/jobs.js';
import { notificationsJobHandlers, NOTIFICATIONS_PURGE_JOB } from './modules/notifications/jobs.js';
import {
  tasksJobHandlers,
  TASK_DEADLINE_CRON,
  TASK_DEADLINE_JOB,
  TASK_REMINDER_TZ,
  TASK_URGENT_CRON,
  TASK_URGENT_JOB,
} from './modules/tasks/jobs.js';
import { createDb, type Db } from './infra/db/client.js';
import { createEmailSender, emailJobHandlers, type EmailSender } from './infra/email/index.js';
import { startJobs, type JobQueue } from './infra/jobs/jobs.js';
import { createPushSender, type PushSender } from './infra/push/index.js';
import { createDiskStorage, type Storage } from './infra/storage/index.js';

/** Everything a module needs from the outside world; every module plugin receives this. */
export type AppDeps = {
  config: Config;
  db: Db;
  email: EmailSender;
  storage: Storage;
  jobs: JobQueue;
  /** null when web push is not configured. */
  push: PushSender | null;
};

/** Creates the real dependencies. `close` stops the jobs, then the database. */
export async function createDeps(
  config: Config,
): Promise<{ deps: AppDeps; close(): Promise<void> }> {
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const email = createEmailSender(config.email);
  const storage = createDiskStorage(config.filesDir, config.appSecret);
  // The reminder handlers send jobs themselves, but the queue exists only once the handlers do.
  const lateQueue: JobQueue = {
    send: (name, data, options) => {
      return jobs.queue.send(name, data, options); // `jobs` is set before any handler runs
    },
  };
  const jobs = await startJobs(
    config.databaseUrl,
    {
      ...emailJobHandlers(email),
      ...authJobHandlers(db),
      ...filesJobHandlers({ db, storage }),
      ...notificationsJobHandlers(db),
      ...tasksJobHandlers({ db, jobs: lateQueue }),
    },
    [
      { name: AUTH_CLEANUP_JOB, cron: '15 3 * * *' }, // daily, 03:15
      { name: FILES_CLEANUP_JOB, cron: '30 3 * * *' },
      { name: NOTIFICATIONS_PURGE_JOB, cron: '45 3 * * *' },
      { name: TASK_DEADLINE_JOB, cron: TASK_DEADLINE_CRON, tz: TASK_REMINDER_TZ },
      { name: TASK_URGENT_JOB, cron: TASK_URGENT_CRON, tz: TASK_REMINDER_TZ },
    ],
  );
  return {
    deps: { config, db, email, storage, jobs: jobs.queue, push: createPushSender(config.push) },
    async close() {
      await jobs.stop();
      await closeDb();
    },
  };
}
