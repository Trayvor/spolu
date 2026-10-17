import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { TaskDeadlinePayload, TaskUrgentPayload } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import {
  recordManyNotifications,
  requestDelivery,
  type NotificationInput,
} from '../notifications/service.js';
import { taskAssignees, tasks } from './schema.js';

const TIME_ZONE = 'Europe/Bratislava';
const DEADLINE_DAYS = [1, 2, 3] as const;

const partsFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hourCycle: 'h23',
});

function parts(now: Date): { year: string; month: string; day: string; hour: string } {
  const out: Record<string, string> = {};
  for (const p of partsFormat.formatToParts(now)) out[p.type] = p.value;
  return out as { year: string; month: string; day: string; hour: string };
}

/** The calendar date in Bratislava, `YYYY-MM-DD`. */
export function bratislavaDay(now: Date): string {
  const { year, month, day } = parts(now);
  return `${year}-${month}-${day}`;
}

/** The hour of the day in Bratislava, 0 to 23. */
export function bratislavaHour(now: Date): number {
  return Number(parts(now).hour);
}

/** `day` (`YYYY-MM-DD`) plus `n` calendar days; plain date arithmetic, no time zone involved. */
function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

type Reminded = { id: string; groupId: string; title: string; dueDate: string | null };

/** The assignees of each task, in task order. */
async function assigneesOf(
  db: AppDeps['db'],
  where: ReturnType<typeof and>,
): Promise<Map<string, { task: Reminded; userIds: string[] }>> {
  const rows = await db
    .select({
      id: tasks.id,
      groupId: tasks.groupId,
      title: tasks.title,
      dueDate: tasks.dueDate,
      userId: taskAssignees.userId,
    })
    .from(tasks)
    .innerJoin(taskAssignees, eq(taskAssignees.taskId, tasks.id))
    .where(where)
    .orderBy(tasks.id, taskAssignees.userId);
  const byTask = new Map<string, { task: Reminded; userIds: string[] }>();
  for (const { userId, ...task } of rows) {
    const entry = byTask.get(task.id) ?? { task, userIds: [] };
    entry.userIds.push(userId);
    byTask.set(task.id, entry);
  }
  return byTask;
}

/**
 * Records a `task.deadline` event for each assignee of every open task due in 1, 2 or 3 days
 * (counted in Bratislava days), once per task, user and day. Returns how many events were
 * recorded; a rerun on the same day records none.
 */
export async function recordDeadlineReminders(
  deps: Pick<AppDeps, 'db' | 'jobs'>,
  now: Date,
): Promise<number> {
  const { db, jobs } = deps;
  const today = bratislavaDay(now);
  const daysLeftByDate = new Map(DEADLINE_DAYS.map((n) => [addDays(today, n), n]));
  const found = await assigneesOf(
    db,
    and(isNull(tasks.completedAt), inArray(tasks.dueDate, [...daysLeftByDate.keys()])),
  );

  const inputs: NotificationInput[] = [...found.values()].map(({ task, userIds }) => {
    const payload: TaskDeadlinePayload = {
      taskId: task.id,
      groupId: task.groupId,
      title: task.title,
      daysLeft: daysLeftByDate.get(task.dueDate!)!,
    };
    return {
      kind: 'task.deadline',
      groupId: task.groupId,
      recipients: userIds,
      payload,
      dedupeKey: `deadline:${task.id}:${today}`,
    };
  });
  // Every task in one statement (Phase 27 S7), not one per task.
  const recorded = await recordManyNotifications(db, inputs);
  await requestDelivery(jobs, recorded);
  return recorded.length;
}

/**
 * Records a `task.urgent` event for each assignee of every open urgent task, once per task, user
 * and Bratislava hour slot (`<day>T<HH>`). Returns how many events were recorded.
 */
export async function recordUrgentReminders(
  deps: Pick<AppDeps, 'db' | 'jobs'>,
  now: Date,
): Promise<number> {
  const { db, jobs } = deps;
  const slot = `${bratislavaDay(now)}T${String(bratislavaHour(now)).padStart(2, '0')}`;
  const found = await assigneesOf(db, and(isNull(tasks.completedAt), eq(tasks.urgent, true)));

  const inputs: NotificationInput[] = [...found.values()].map(({ task, userIds }) => {
    const payload: TaskUrgentPayload = {
      taskId: task.id,
      groupId: task.groupId,
      title: task.title,
    };
    return {
      kind: 'task.urgent',
      groupId: task.groupId,
      recipients: userIds,
      payload,
      dedupeKey: `urgent:${task.id}:${slot}`,
    };
  });
  const recorded = await recordManyNotifications(db, inputs);
  await requestDelivery(jobs, recorded);
  return recorded.length;
}
