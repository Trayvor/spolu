import { inArray } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { RemindersEvents, type TaskRemindersEvent } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { emitToGroup } from '../../infra/realtime/rooms.js';
import { countUpcomingTimes } from '../reminders/service.js';
import {
  registerReminderSubject,
  type ReminderSubject,
  type SubjectInfo,
} from '../reminders/subjects.js';
import { canUseBoard } from './policy.js';
import { tasks } from './schema.js';

/** Tasks as reminder subjects: one query for any number of ids. */
async function loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>> {
  const map = new Map<string, SubjectInfo>();
  if (ids.length === 0) return map;
  const rows = await db
    .select({
      id: tasks.id,
      groupId: tasks.groupId,
      title: tasks.title,
      description: tasks.description,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
      createdBy: tasks.createdBy,
    })
    .from(tasks)
    .where(inArray(tasks.id, ids));
  for (const row of rows) {
    map.set(row.id, {
      groupId: row.groupId,
      title: row.title,
      body: row.description,
      dueDate: row.dueDate,
      adminsOnly: false,
      // A task in Completed reminds nobody, like the automatic reminders.
      active: row.completedAt === null,
      authorId: row.createdBy,
      link: `/groups/${row.groupId}/tasks/${row.id}`,
      canRead: (actor, actorGroupId) => canUseBoard(actor, row.groupId, actorGroupId),
      // Everyone who uses the board edits its tasks; every route checks `canRead` first.
      canEdit: () => true,
    });
  }
  return map;
}

/** The unfired custom reminder times of each task (0 for a task without any): one query. */
export function countUpcomingReminders(db: Db, taskIds: string[]): Promise<Map<string, number>> {
  return countUpcomingTimes(db, 'task', taskIds);
}

/** Pushes each task's new count to its group room (the board card's bell). */
async function onTimesChanged(deps: { db: Db; io: SocketIOServer }, ids: string[]) {
  const [rows, counts] = await Promise.all([
    deps.db
      .select({ id: tasks.id, groupId: tasks.groupId })
      .from(tasks)
      .where(inArray(tasks.id, ids)),
    countUpcomingReminders(deps.db, ids),
  ]);
  for (const row of rows) {
    const event: TaskRemindersEvent = {
      groupId: row.groupId,
      taskId: row.id,
      upcomingReminders: counts.get(row.id) ?? 0,
    };
    emitToGroup(deps.io, row.groupId, RemindersEvents.task, event);
  }
}

export const taskReminderSubject: ReminderSubject = {
  kind: 'task',
  routePrefix: 'tasks',
  standaloneEdit: true,
  addEditorsAsRecipients: true,
  loadMany,
  onTimesChanged,
};

/** Registers the `task` kind (endpoints under `/api/tasks/:id/reminders`). Idempotent. */
export function registerTaskReminderSubject(): void {
  registerReminderSubject(taskReminderSubject);
}
