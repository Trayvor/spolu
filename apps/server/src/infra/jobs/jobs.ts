import { PgBoss } from 'pg-boss';

/** The pg-boss send options we use. */
export interface JobOptions {
  expireInSeconds?: number;
  retentionSeconds?: number;
  deleteAfterSeconds?: number;
}

export interface JobQueue {
  send(name: string, data: object, options?: JobOptions): Promise<void>;
}

/** One handler per job name; a thrown error makes pg-boss retry the job. */
export type JobHandlers = Record<string, (data: object) => Promise<void>>;

/**
 * Starts the pg-boss job queue in the app's PostgreSQL (schema `pgboss`, created on first start)
 * with a queue and a worker for each handler.
 */
export async function startJobs(
  databaseUrl: string,
  handlers: JobHandlers,
): Promise<{ queue: JobQueue; stop(): Promise<void> }> {
  const boss = new PgBoss(databaseUrl);
  // Without a listener an 'error' event would crash the process; log and keep running.
  boss.on('error', (error) => console.error('pg-boss error:', error));
  await boss.start();

  for (const [name, handler] of Object.entries(handlers)) {
    await boss.createQueue(name);
    await boss.work(name, async (jobs) => {
      for (const job of jobs) await handler(job.data as object);
    });
  }

  return {
    queue: {
      async send(name, data, options) {
        await boss.send(name, data, options);
      },
    },
    // Graceful, but under the 30 s compose stop grace period.
    stop: () => boss.stop({ graceful: true, timeout: 20_000 }),
  };
}
