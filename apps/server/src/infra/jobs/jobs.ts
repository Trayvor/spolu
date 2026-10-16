import { PgBoss } from 'pg-boss';

/** The pg-boss send options we use. */
export interface JobOptions {
  expireInSeconds?: number;
  retentionSeconds?: number;
  deleteAfterSeconds?: number;
  /** Delay before the job becomes available, in seconds. */
  startAfter?: number;
  retryLimit?: number;
  /** Seconds between retries. */
  retryDelay?: number;
}

export interface JobQueue {
  send(name: string, data: object, options?: JobOptions): Promise<void>;
}

/**
 * A queue for handlers that send jobs to the queue built from them. `send` waits until `resolve`
 * hands over the real queue: pg-boss may run a job before `startJobs` returns, and a send must
 * not fail then (a delivered event's push would be lost).
 */
export function createDeferredQueue(): { queue: JobQueue; resolve(queue: JobQueue): void } {
  let resolve!: (queue: JobQueue) => void;
  const ready = new Promise<JobQueue>((r) => (resolve = r));
  return {
    queue: { send: async (...args) => (await ready).send(...args) },
    resolve,
  };
}

/** One handler per job name; a thrown error makes pg-boss retry the job. */
export type JobHandlers = Record<string, (data: object) => Promise<void>>;

/** A job sent on a cron schedule; `handlers` must have a handler for `name`. */
export interface JobSchedule {
  name: string;
  cron: string;
  /** IANA time zone the cron runs in; default UTC. */
  tz?: string;
}

/**
 * Starts the pg-boss job queue in the app's PostgreSQL (schema `pgboss`, created on first start)
 * with a queue and a worker for each handler.
 */
export async function startJobs(
  databaseUrl: string,
  handlers: JobHandlers,
  schedules: JobSchedule[] = [],
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

  // The queue exists by now; a schedule with the same name replaces the earlier one.
  for (const { name, cron, tz } of schedules) {
    if (!handlers[name]) throw new Error(`No handler for scheduled job "${name}"`);
    await boss.schedule(name, cron, {}, tz ? { tz } : {});
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
