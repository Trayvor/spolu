import type { AppDeps } from '../../deps.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import { recordDeadlineReminders, recordUrgentReminders } from './reminders.js';

/** Daily at 09:00 Bratislava time. */
export const TASK_DEADLINE_JOB = 'tasks.deadline-reminders';
export const TASK_DEADLINE_CRON = '0 9 * * *';
/** 08, 11, 14, 17 and 20 Bratislava time. */
export const TASK_URGENT_JOB = 'tasks.urgent-reminders';
export const TASK_URGENT_CRON = '0 8,11,14,17,20 * * *';
/** Both crons run in this time zone, so daylight saving changes need no care. */
export const TASK_REMINDER_TZ = 'Europe/Bratislava';

/** Job handlers of the tasks module; passed to `startJobs`. */
export function tasksJobHandlers(deps: Pick<AppDeps, 'db' | 'jobs'>): JobHandlers {
  return {
    [TASK_DEADLINE_JOB]: async () => void (await recordDeadlineReminders(deps, new Date())),
    [TASK_URGENT_JOB]: async () => void (await recordUrgentReminders(deps, new Date())),
  };
}

/** The reminder crons, both in Bratislava time. */
export const taskSchedules: JobSchedule[] = [
  { name: TASK_DEADLINE_JOB, cron: TASK_DEADLINE_CRON, tz: TASK_REMINDER_TZ },
  { name: TASK_URGENT_JOB, cron: TASK_URGENT_CRON, tz: TASK_REMINDER_TZ },
];
