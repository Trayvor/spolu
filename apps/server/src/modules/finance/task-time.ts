import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import type { SessionUser, TaskTimeDto, TimeRequestRow } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { recordNotifications } from '../notifications/service.js';
import { getActiveRoles, getUserNames } from '../users/service.js';
import { emitFinanceChanged, emitTimeRequests } from './events.js';
import { canLogOwnTaskTime, canSeeFinance } from './policy.js';
import { financeTimeEntries as entries } from './schema.js';
import { userActor, type AuditActor } from '../audit/actor.js';
import { entryValues, recordEntry } from './audit.js';

/**
 * Time on done (Phase 32, spec §5): the hooks the tasks module calls inside its own transactions,
 * the dashboard's requests and the caller's own time on a task. It must not import
 * `modules/tasks` (the tasks module imports it: no cycle); everything about the task comes in
 * the arguments.
 */

/** The calendar day of `at` in Europe/Bratislava, `YYYY-MM-DD` (the day a time entry counts on). */
export function bratislavaDay(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/** The active admins (and the superadmin) among these users, in one query: who is asked. */
export async function adminIdsAmong(db: Db, ids: readonly string[]): Promise<string[]> {
  const roles = await getActiveRoles(db, [...ids]);
  return [...new Set(ids)].filter((id) => {
    const role = roles.get(id);
    return role === 'admin' || role === 'superadmin';
  });
}

/**
 * What a task or ticket write did to time entries, for the caller to announce after the commit
 * (`announceTimeChange`): whether any entry changed (`finance:changed` to the finance room), whose
 * open requests changed (`time:requests`), and the notification events to deliver.
 */
export type TimeChange = {
  groupId: string | null;
  changed: boolean;
  users: string[];
  eventIds: string[];
};

export const noTimeChange = (groupId: string | null = null): TimeChange => ({
  groupId,
  changed: false,
  users: [],
  eventIds: [],
});

/** Whose requests went (a reopen, a removal, a delete) as a time change. */
export const droppedRequests = (groupId: string | null, users: string[]): TimeChange => ({
  groupId,
  changed: users.length > 0,
  users,
  eventIds: [],
});

/**
 * What a task or ticket write did to time on done: `askTime` for its answer (the actor is an
 * admin assignee or riešiteľ asked for their time), and the change for `announceTimeChange`.
 */
export type TimeEffect = { askTime: boolean; time: TimeChange };

export const noTimeEffect = (groupId: string | null = null): TimeEffect => ({
  askTime: false,
  time: noTimeChange(groupId),
});

/**
 * After the write committed: tells the finance room that time changed, and every user whose open
 * requests changed their new count (the dashboard's "Fill in your time" rows). A socket failure
 * never fails the write; delivery of `eventIds` is the caller's (`requestDelivery`).
 */
export async function announceTimeChange(
  db: Db,
  io: SocketIOServer,
  change: TimeChange,
): Promise<void> {
  // `groupId` null: time without a client (decision 24), shown on the system-wide page only.
  if (change.changed) emitFinanceChanged(io, change.groupId, 'time');
  for (const userId of change.users) {
    emitTimeRequests(io, userId, await countMyTimeRequests(db, userId));
  }
}

/** A task's `completed_at` went from null to a time. */
export type TaskCompletedEvent = {
  taskId: string;
  groupId: string;
  title: string;
  completedAt: Date;
  actorId: string;
  /** For the notification's payload. */
  actorName: string;
  assigneeIds: string[];
  /** The task's `source_ticket_id`: its entries join that ticket's unit (`linked_ticket_id`). */
  sourceTicketId: string | null;
  /** The task's project and event (Phase 33 P6), copied onto its entries. */
  projectId?: string | null;
  eventId?: string | null;
};

/**
 * Inserts the requested entries of the admin assignees (or dates entries filled before), records
 * `task.time_missing` for each except the actor; `askActor`: the actor is an admin assignee whose
 * entry is requested (the answer's `askTime`); `notified`: the users asked by notification. The
 * rest is the `TimeChange` to announce after the commit.
 */
export async function onTaskCompleted(
  tx: Db,
  e: TaskCompletedEvent,
): Promise<{ askActor: boolean; notified: string[] } & TimeChange> {
  const admins = await adminIdsAmong(tx, e.assigneeIds);
  if (admins.length === 0) return { askActor: false, notified: [], ...noTimeChange(e.groupId) };
  const day = bratislavaDay(e.completedAt);
  // Entries filled before the first completion start counting now.
  await tx
    .update(entries)
    .set({
      workedOn: day,
      linkedTicketId: e.sourceTicketId,
      projectId: e.projectId ?? null,
      eventId: e.eventId ?? null,
    })
    .where(
      and(
        eq(entries.taskId, e.taskId),
        inArray(entries.userId, admins),
        isNull(entries.workedOn),
        isNotNull(entries.minutes),
      ),
    );
  // One entry per admin per task: a concurrent completion's rows win, ours are skipped.
  await tx
    .insert(entries)
    .values(
      admins.map((userId) => ({
        id: randomUUID(),
        groupId: e.groupId,
        userId,
        source: 'task' as const,
        taskId: e.taskId,
        linkedTicketId: e.sourceTicketId,
        projectId: e.projectId ?? null,
        eventId: e.eventId ?? null,
        title: e.title,
        workedOn: day,
        createdBy: e.actorId,
        updatedBy: e.actorId,
      })),
    )
    .onConflictDoNothing({
      target: [entries.taskId, entries.userId],
      where: sql`${entries.taskId} is not null`,
    });
  const requested = (
    await tx
      .select({ userId: entries.userId })
      .from(entries)
      .where(
        and(eq(entries.taskId, e.taskId), inArray(entries.userId, admins), isNull(entries.minutes)),
      )
  ).map((r) => r.userId);
  const notified = requested.filter((id) => id !== e.actorId);
  const eventIds = await recordNotifications(tx, {
    kind: 'task.time_missing',
    groupId: e.groupId,
    recipients: notified,
    payload: { taskId: e.taskId, groupId: e.groupId, title: e.title, actorName: e.actorName },
  });
  return {
    askActor: requested.includes(e.actorId),
    notified,
    groupId: e.groupId,
    changed: true,
    users: requested,
    eventIds,
  };
}

/** Deletes the unanswered requests of a task matching `where`; whose went. */
async function dropRequests(tx: Db, taskId: string, userIds?: string[]): Promise<string[]> {
  if (userIds?.length === 0) return [];
  const rows = await tx
    .delete(entries)
    .where(
      and(
        eq(entries.taskId, taskId),
        isNull(entries.minutes),
        userIds ? inArray(entries.userId, userIds) : undefined,
      ),
    )
    .returning({ userId: entries.userId });
  return rows.map((r) => r.userId);
}

/** Moved out of Completed: deletes the unanswered requests; returns whose requests went. */
export function onTaskReopened(tx: Db, taskId: string): Promise<string[]> {
  return dropRequests(tx, taskId);
}

/** Assignees removed: deletes their unanswered requests (filled time stays); whose went. */
export function onAssigneesRemoved(tx: Db, taskId: string, userIds: string[]): Promise<string[]> {
  return dropRequests(tx, taskId, userIds);
}

/** Before a task is deleted: deletes its requests (filled entries keep `title`); whose went. */
export function onTaskDeleting(tx: Db, taskId: string): Promise<string[]> {
  return dropRequests(tx, taskId);
}

/** Open requests of a user: asked (a day set), not answered. Reads the open-requests index. */
const openRequestsOf = (userId: string) =>
  and(eq(entries.userId, userId), isNull(entries.minutes), isNotNull(entries.workedOn));

/**
 * The caller's open task and ticket requests, oldest first, at most `limit` (the home module's
 * "Fill in your time" rows).
 */
export async function listMyTimeRequests(
  db: Db,
  userId: string,
  limit: number,
): Promise<TimeRequestRow[]> {
  return (await myTimeRequests(db, userId, limit)).rows;
}

/**
 * `listMyTimeRequests` with the count of all of them (a window count before the limit), in one
 * statement: the dashboard's rows and its "N without time". An empty page means none at all.
 */
export async function myTimeRequests(
  db: Db,
  userId: string,
  limit: number,
): Promise<{ rows: TimeRequestRow[]; total: number }> {
  const rows = await db
    .select({
      entryId: entries.id,
      source: entries.source,
      taskId: entries.taskId,
      ticketId: entries.ticketId,
      groupId: entries.groupId,
      title: entries.title,
      workedOn: entries.workedOn,
      total: sql<number>`(count(*) over ())::int`,
    })
    .from(entries)
    .where(openRequestsOf(userId))
    .orderBy(asc(entries.workedOn), asc(entries.createdAt), asc(entries.id))
    .limit(Math.max(limit, 1));
  const total = rows[0]?.total ?? 0;
  const page = rows.slice(0, limit).map((r): TimeRequestRow => ({
    entryId: r.entryId,
    kind: r.source === 'ticket' ? 'ticket' : 'task',
    taskId: r.taskId,
    ticketId: r.ticketId,
    groupId: r.groupId,
    title: r.title ?? '',
    workedOn: r.workedOn!,
  }));
  return { rows: page, total };
}

/** How many open requests the user has (the dashboard's "N without time"). */
export async function countMyTimeRequests(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(entries)
    .where(openRequestsOf(userId));
  return row?.n ?? 0;
}

/**
 * The task as the time routes read it through the tasks module: its group, title, completion
 * (null while not done), source ticket and current assignees.
 */
export type TaskTimeSubject = {
  taskId: string;
  groupId: string;
  title: string;
  completedAt: Date | null;
  sourceTicketId: string | null;
  /** Phase 33 P6: copied onto the entry. */
  projectId?: string | null;
  eventId?: string | null;
  assigneeIds?: string[];
};

/**
 * Writes a user's own minutes on a task: one entry per admin per task. A new entry of a done task
 * counts on its completion day; an existing entry keeps its day (the first completion); before
 * completion it has no day and starts counting at completion. The title is refreshed.
 */
export async function writeTaskTime(
  db: Db,
  userId: string,
  task: TaskTimeSubject,
  minutes: number,
  by?: AuditActor,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    // The entry before the write: the first time is `created`, a later one `updated`.
    const [before] = await tx
      .select()
      .from(entries)
      .where(and(eq(entries.taskId, task.taskId), eq(entries.userId, userId)));
    const [row] = await tx
      .insert(entries)
      .values({
        id: randomUUID(),
        groupId: task.groupId,
        userId,
        source: 'task',
        taskId: task.taskId,
        linkedTicketId: task.sourceTicketId,
        projectId: task.projectId ?? null,
        eventId: task.eventId ?? null,
        title: task.title,
        minutes,
        workedOn: task.completedAt ? bratislavaDay(task.completedAt) : null,
        createdBy: userId,
        updatedBy: userId,
        filledAt: now,
      })
      .onConflictDoUpdate({
        target: [entries.taskId, entries.userId],
        targetWhere: sql`${entries.taskId} is not null`,
        set: {
          minutes,
          title: task.title,
          groupId: task.groupId,
          linkedTicketId: task.sourceTicketId,
          projectId: task.projectId ?? null,
          eventId: task.eventId ?? null,
          workedOn: sql`coalesce(${entries.workedOn}, excluded.worked_on)`,
          updatedBy: userId,
          updatedAt: now,
          filledAt: now,
        },
      })
      .returning();
    if (row) {
      if (before) await recordEntry(tx, by, 'updated', row, await entryValues(tx, before));
      else await recordEntry(tx, by, 'created', row);
    }
  });
}

/**
 * `GET /api/tasks/:id/time`: the caller's own entry (`mine`, null unless they are an admin
 * assignee) and, for a finance admin only, every admin's time on the task (the current admin
 * assignees and anyone who has an entry).
 */
export async function getTaskTime(
  db: Db,
  actor: SessionUser,
  task: TaskTimeSubject & { assigneeIds: string[] },
): Promise<TaskTimeDto> {
  const finance = canSeeFinance(actor);
  const rows = await db
    .select({ userId: entries.userId, minutes: entries.minutes, workedOn: entries.workedOn })
    .from(entries)
    .where(
      and(eq(entries.taskId, task.taskId), finance ? undefined : eq(entries.userId, actor.id)),
    );
  const byUser = new Map(rows.map((r) => [r.userId, r]));
  const state = (userId: string) => {
    const row = byUser.get(userId);
    return {
      minutes: row?.minutes ?? null,
      requested: row !== undefined && row.minutes === null && row.workedOn !== null,
    };
  };
  const dto: TaskTimeDto = {
    mine: canLogOwnTaskTime(actor, task.assigneeIds) ? state(actor.id) : null,
  };
  if (!finance) return dto;
  const admins = await adminIdsAmong(db, task.assigneeIds);
  const ids = [...new Set([...admins, ...rows.map((r) => r.userId)])];
  const names = await getUserNames(db, ids);
  dto.assignees = ids
    .map((userId) => ({ userId, name: names.get(userId) ?? '', ...state(userId) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sk') || a.userId.localeCompare(b.userId));
  return dto;
}

/**
 * `PUT /api/tasks/:id/time/me`: the caller's own minutes on a task. The route checked the board
 * and `canLogOwnTaskTime`. Announces the change (the finance room, the caller's request count).
 */
export async function fillTaskTime(
  deps: { db: Db; io: SocketIOServer },
  actor: SessionUser,
  task: TaskTimeSubject & { assigneeIds: string[] },
  minutes: number,
  by: AuditActor = userActor(actor),
): Promise<TaskTimeDto> {
  await writeTaskTime(deps.db, actor.id, task, minutes, by);
  await announceTimeChange(deps.db, deps.io, {
    groupId: task.groupId,
    changed: true,
    users: [actor.id],
    eventIds: [],
  });
  return getTaskTime(deps.db, actor, task);
}
