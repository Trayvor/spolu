/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures until part A2 fills them */
import type { Server as SocketIOServer } from 'socket.io';
import type { SessionUser, TaskTimeDto, TimeRequestRow } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * Time on done (Phase 32, spec §5): the hooks the tasks module calls inside its own transactions,
 * and the dashboard's requests. Part A2 owns this file and replaces the stubs. It must not import
 * `modules/tasks` (the tasks module imports it: no cycle); task titles come in the arguments.
 */

const notImplemented = (): never => {
  throw new Error('not implemented (Phase 32 part A2)');
};

/** A task's `completed_at` went from null to a time. */
export type TaskCompletedEvent = {
  taskId: string;
  groupId: string;
  title: string;
  completedAt: Date;
  actorId: string;
  assigneeIds: string[];
  /** The task's `source_ticket_id`: its entries join that ticket's unit (`linked_ticket_id`). */
  sourceTicketId: string | null;
};

/**
 * Inserts the requested entries of the admin assignees (or dates entries filled before), records
 * `task.time_missing` for each except the actor; `askActor`: the actor is an admin assignee whose
 * entry is requested (the answer's `askTime`); `notified`: the users asked by notification.
 */
export async function onTaskCompleted(
  _tx: Db,
  _e: TaskCompletedEvent,
): Promise<{ askActor: boolean; notified: string[] }> {
  return notImplemented();
}

/** Moved out of Completed: deletes the unanswered requests; returns whose requests went. */
export async function onTaskReopened(_tx: Db, _taskId: string): Promise<string[]> {
  return notImplemented();
}

/** Assignees removed: deletes their unanswered requests (filled time stays). */
export async function onAssigneesRemoved(
  _tx: Db,
  _taskId: string,
  _userIds: string[],
): Promise<void> {
  return notImplemented();
}

/** Before a task is deleted: deletes its requests (filled entries keep `task_title`); whose went. */
export async function onTaskDeleting(_tx: Db, _taskId: string): Promise<string[]> {
  return notImplemented();
}

/**
 * The caller's open task and ticket requests, oldest first, at most `limit` (the home module's
 * "Fill in your time" rows).
 */
export async function listMyTimeRequests(
  _db: Db,
  _userId: string,
  _limit: number,
): Promise<TimeRequestRow[]> {
  return notImplemented();
}

/** `PUT /api/tasks/:id/time/me`: the caller's own minutes on a task. */
export async function fillTaskTime(
  _deps: { db: Db; io: SocketIOServer },
  _actor: SessionUser,
  _taskId: string,
  _minutes: number,
): Promise<TaskTimeDto> {
  return notImplemented();
}
