import type { AppDeps } from '../../deps.js';
import type { JobHandlers, JobSchedule } from '../../infra/jobs/jobs.js';
import {
  recordDeadlineReminders,
  recordOverdueReminders,
  recordUrgentReminders,
} from './reminders.js';

/** Daily at 09:00 Bratislava time: deadlines (3, 2 and 1 days before) and overdue tasks. */
export const TASK_DEADLINE_JOB = 'tasks.deadline-reminders';
export const TASK_DEADLINE_CRON = '0 9 * * *';
/** 08, 11, 14, 17 and 20 Bratislava time, every day (owner 2026-10-18: no default silence). */
export const TASK_URGENT_JOB = 'tasks.urgent-reminders';
export const TASK_URGENT_CRON = '0 8,11,14,17,20 * * *';
/** Both crons run in this time zone, so daylight saving changes need no care. */
const TASK_REMINDER_TZ = 'Europe/Bratislava';

/** Job handlers of the tasks module; passed to `startJobs`. */
export function tasksJobHandlers(deps: Pick<AppDeps, 'db' | 'jobs'>): JobHandlers {
  return {
    [TASK_DEADLINE_JOB]: async () => {
      const now = new Date();
      await recordDeadlineReminders(deps, now);
      await recordOverdueReminders(deps, now);
    },
    [TASK_URGENT_JOB]: async () => void (await recordUrgentReminders(deps, new Date())),
  };
}

/** The reminder crons, both in Bratislava time. */
export const taskSchedules: JobSchedule[] = [
  { name: TASK_DEADLINE_JOB, cron: TASK_DEADLINE_CRON, tz: TASK_REMINDER_TZ },
  { name: TASK_URGENT_JOB, cron: TASK_URGENT_CRON, tz: TASK_REMINDER_TZ },
];
