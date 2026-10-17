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
  /**
   * Sends one job per item with the same options, in one statement (pg-boss `insert`). Optional:
   * a caller without it sends one by one.
   */
  sendMany?(name: string, items: object[], options?: JobOptions): Promise<void>;
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
    queue: {
      send: async (...args) => (await ready).send(...args),
      sendMany: async (name, items, options) => {
        const queue = await ready;
        if (queue.sendMany) await queue.sendMany(name, items, options);
        else for (const data of items) await queue.send(name, data, options);
      },
    },
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

/** How one queue is created and worked; every field is optional. */
export interface QueueSettings {
  /**
   * pg-boss queue policy (default `standard`). `stately` keeps at most one job queued and one
   * active, so a burst of sends coalesces into one run. pg-boss cannot change the policy of an
   * existing queue: `startJobs` deletes and recreates a queue whose policy differs, which drops
   * its waiting jobs, so give a policy only to queues whose jobs a sweep recovers.
   */
  policy?: 'standard' | 'stately';
  /** Jobs of this queue run at once in this process (default 1). */
  localConcurrency?: number;
  /** Idle poll in seconds when LISTEN/NOTIFY is down (default 2, at least 0.5). */
  pollingIntervalSeconds?: number;
  /**
   * Backstop poll in seconds while LISTEN/NOTIFY is up (default 30). A burst larger than
   * `localConcurrency` sends its NOTIFYs while every worker is busy, so the leftover jobs wait
   * for this poll; a queue that must drain bursts fast sets it low.
   */
  notifyPollingIntervalSeconds?: number;
  /**
   * LISTEN/NOTIFY wake-ups (default true). A notify queue polls only every 30 s, and a delayed job
   * (`startAfter`) sends no NOTIFY when it becomes due, so a queue of delayed jobs sets `false`
   * and is polled every `pollingIntervalSeconds` instead.
   */
  notify?: boolean;
}

/**
 * Starts the pg-boss job queue in the app's PostgreSQL (schema `pgboss`, created on first start)
 * with a queue and a worker for each handler, set up by `queues[name]` when given.
 * LISTEN/NOTIFY is on, so a sent job wakes its worker at once; polling stays as the fallback
 * (every 30 s on a notify queue; queues of delayed jobs opt out with `notify: false`).
 */
export async function startJobs(
  databaseUrl: string,
  handlers: JobHandlers,
  schedules: JobSchedule[] = [],
  queues: Record<string, QueueSettings> = {},
): Promise<{ queue: JobQueue; stop(): Promise<void> }> {
  const boss = new PgBoss({ connectionString: databaseUrl, useListenNotify: true });
  // Without a listener an 'error' event would crash the process; log and keep running.
  boss.on('error', (error) => console.error('pg-boss error:', error));
  // E.g. LISTEN/NOTIFY could not be set up (pg-boss keeps polling).
  boss.on('warning', (warning) => console.warn('pg-boss warning:', warning));
  await boss.start();

  for (const [name, handler] of Object.entries(handlers)) {
    const {
      policy = 'standard',
      localConcurrency,
      pollingIntervalSeconds,
      notifyPollingIntervalSeconds,
      notify = true,
    } = queues[name] ?? {};
    let existing = await boss.getQueue(name);
    if (existing && existing.policy !== policy) {
      console.warn(`pg-boss: recreating queue ${name} (policy ${existing.policy} -> ${policy})`);
      await boss.deleteQueue(name);
      existing = null;
    }
    if (!existing) await boss.createQueue(name, { policy, notify });
    else if (existing.notify !== notify) await boss.updateQueue(name, { notify });
    await boss.work(
      name,
      {
        ...(localConcurrency ? { localConcurrency } : {}),
        ...(pollingIntervalSeconds ? { pollingIntervalSeconds } : {}),
        ...(notifyPollingIntervalSeconds ? { notifyPollingIntervalSeconds } : {}),
      },
      async (jobs) => {
        for (const job of jobs) await handler(job.data as object);
      },
    );
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
      async sendMany(name, items, options) {
        await boss.insert(
          name,
          items.map((data) => ({ data, ...options })),
        );
      },
    },
    // Graceful, but under the 30 s compose stop grace period.
    stop: () => boss.stop({ graceful: true, timeout: 20_000 }),
  };
}
