import type { Db } from '../../infra/db/client.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { expireSubstitutions } from './substitutions.js';

/** Ends the admin substitutions whose last day has passed (ADR 0059). */
export const SUBSTITUTIONS_EXPIRE_JOB = 'groups.substitutions-expire';

/** Job handlers of the groups module; passed to `startJobs`. */
export function groupsJobHandlers(db: Db): JobHandlers {
  return {
    // Idempotent: an ended substitution is never ended again, so a retry or a late run is safe.
    [SUBSTITUTIONS_EXPIRE_JOB]: async () => void (await expireSubstitutions(db)),
  };
}

/** Hourly at :05 Bratislava time: the first run of a day ends yesterday's last days. */
export const groupsSchedules: JobSchedule[] = [
  { name: SUBSTITUTIONS_EXPIRE_JOB, cron: '5 * * * *', tz: 'Europe/Bratislava' },
];
