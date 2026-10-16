import type { Config } from './infra/config/config.js';
import { createAiProvider } from './modules/ai/index.js';
import type { TaskSplitProvider } from './modules/ai/provider.js';
import { authJobHandlers, AUTH_CLEANUP_JOB } from './modules/auth/jobs.js';
import { bulkEmailJobHandlers, bulkEmailSchedules } from './modules/bulk-email/jobs.js';
import { filesJobHandlers, FILES_CLEANUP_JOB } from './modules/files/jobs.js';
import {
  notificationQueues,
  notificationSchedules,
  notificationsJobHandlers,
} from './modules/notifications/jobs.js';
import { registerKnowledgeReminderSubject } from './modules/knowledge/reminder-subject.js';
import { registerTaskReminderSubject } from './modules/tasks/reminder-subject.js';
import { reminderSchedules, remindersJobHandlers } from './modules/reminders/jobs.js';
import { tasksJobHandlers, taskSchedules } from './modules/tasks/jobs.js';
import { createDb, type Db } from './infra/db/client.js';
import {
  createBulkSender,
  createEmailSender,
  emailJobHandlers,
  emailQueues,
  type BulkEmailSender,
  type EmailSender,
} from './infra/email/index.js';
import { createDeferredQueue, startJobs, type JobQueue } from './infra/jobs/jobs.js';
import { createPushSender, type PushSender } from './infra/push/index.js';
import { createDiskStorage, type Storage } from './infra/storage/index.js';

/** Everything a module needs from the outside world; every module plugin receives this. */
export type AppDeps = {
  config: Config;
  db: Db;
  email: EmailSender;
  /** The bulk email sender (Phase 23), separate from the transactional `email`. */
  bulkEmail: BulkEmailSender;
  storage: Storage;
  jobs: JobQueue;
  /** null when web push is not configured. */
  push: PushSender | null;
  /** The AI task split provider; null when AI is off (no OpenAI key). */
  ai: TaskSplitProvider | null;
};

/** Creates the real dependencies. `close` stops the jobs, then the database. */
export async function createDeps(
  config: Config,
): Promise<{ deps: AppDeps; close(): Promise<void> }> {
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const email = createEmailSender(config.email);
  const bulkEmail = createBulkSender(config.bulkEmail, config.email);
  const storage = createDiskStorage(config.filesDir, config.appSecret);
  const push = createPushSender(config.push);
  // The notification and reminder handlers send jobs to the queue built from them; a job that
  // runs before startJobs returns waits for it.
  const forward = createDeferredQueue();
  // The fire job loads subjects through the registry.
  registerKnowledgeReminderSubject();
  registerTaskReminderSubject();
  const jobs = await startJobs(
    config.databaseUrl,
    {
      ...emailJobHandlers(email),
      ...authJobHandlers(db),
      ...filesJobHandlers({ db, storage }),
      ...notificationsJobHandlers({ db, config, push, jobs: forward.queue }),
      ...tasksJobHandlers({ db, jobs: forward.queue }),
      ...remindersJobHandlers({ db, jobs: forward.queue }),
      ...bulkEmailJobHandlers({ db, config }),
    },
    [
      { name: AUTH_CLEANUP_JOB, cron: '15 3 * * *' }, // daily, 03:15
      { name: FILES_CLEANUP_JOB, cron: '30 3 * * *' },
      ...notificationSchedules, // delivery sweep every minute, purge at 03:45
      ...taskSchedules, // deadline and urgent reminders, Bratislava time
      ...reminderSchedules, // fire due reminders every minute
      ...bulkEmailSchedules(config), // Elastic suppression sync at 04:30, only with the elastic driver
    ],
    { ...emailQueues, ...notificationQueues }, // concurrency and policies; the rest: defaults
  );
  forward.resolve(jobs.queue);
  return {
    deps: {
      config,
      db,
      email,
      bulkEmail,
      storage,
      jobs: jobs.queue,
      push,
      ai: createAiProvider(config.ai),
    },
    async close() {
      await jobs.stop();
      await closeDb();
    },
  };
}
