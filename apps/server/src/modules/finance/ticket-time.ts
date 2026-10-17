import { randomUUID } from 'node:crypto';
import { and, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import type { PutMyTicketTimeBody, SessionUser, TicketTimeDto } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { recordNotifications } from '../notifications/service.js';
import { getUserNames } from '../users/service.js';
import { canLogOwnTicketTime, canSeeFinance } from './policy.js';
import { financeTimeEntries as entries } from './schema.js';
import {
  adminIdsAmong,
  announceTimeChange,
  bratislavaDay,
  noTimeChange,
  type TimeChange,
} from './task-time.js';

/**
 * Time on a resolved ticket (Phase 32, spec §5.6, the 2026-10-17 extension): the hooks the
 * tickets module calls inside its own transactions and the caller's own time on a ticket. It
 * must not import `modules/tickets` (the tickets module imports it): everything it needs comes in
 * the arguments.
 *
 * Owner decision 24 (2026-10-17): a ticket without a client asks time like any other; its
 * entries have no client (`group_id` null, migration 0035), appear in no client's tab, only on
 * the system-wide page as "Bez klienta", and move to the client the ticket gets
 * (`onTicketMoved`).
 */

/** A ticket entry's title: "#123 Subject", so a request row and a deleted ticket still say which. */
export const ticketEntryTitle = (number: number, subject: string) => `#${number} ${subject}`.trim();

/** A ticket's status became `resolved` (from another status). */
export type TicketResolvedEvent = {
  ticketId: string;
  /** Null: a ticket without a client; its entries have no client either (decision 24). */
  groupId: string | null;
  /** The ticket's number (`#123`), for the entry's title and the notification. */
  number: number;
  /** The ticket's subject (may be empty). */
  title: string;
  resolvedAt: Date;
  actorId: string;
  actorName: string;
  /**
   * The ticket's riešitelia (`ticket_assignees`, as `modules/tickets/audience.ts` reads them);
   * only the active admins among them are asked, never client watchers.
   */
  assigneeIds: string[];
  /** The tasks made from the ticket (`tasks.source_ticket_id`). */
  linkedTaskIds: string[];
};

/** Some of these tasks has filled time above 0 that counts (its task was completed). */
async function tasksLogged(db: Db, taskIds: string[]): Promise<boolean> {
  if (taskIds.length === 0) return false;
  const [row] = await db
    .select({ id: entries.id })
    .from(entries)
    .where(
      and(inArray(entries.taskId, taskIds), gt(entries.minutes, 0), isNotNull(entries.workedOn)),
    )
    .limit(1);
  return row !== undefined;
}

/**
 * Inserts requested ticket entries for the admin riešitelia without one (or dates entries filled
 * before), records `ticket.time_missing` for each except the actor. `askActor`: the actor is an
 * admin riešiteľ whose entry is requested (the status answer's `askTime`); `linkedTasksLogged`: a
 * linked task is done with filled time, so the dialog offers option (b).
 */
export async function onTicketResolved(
  tx: Db,
  e: TicketResolvedEvent,
): Promise<{ askActor: boolean; notified: string[]; linkedTasksLogged: boolean } & TimeChange> {
  const none = { askActor: false, notified: [], linkedTasksLogged: false };
  const admins = await adminIdsAmong(tx, e.assigneeIds);
  if (admins.length === 0) return { ...none, ...noTimeChange(e.groupId) };
  const day = bratislavaDay(e.resolvedAt);
  const title = ticketEntryTitle(e.number, e.title);
  await tx
    .update(entries)
    .set({ workedOn: day })
    .where(
      and(
        eq(entries.ticketId, e.ticketId),
        inArray(entries.userId, admins),
        isNull(entries.workedOn),
        isNotNull(entries.minutes),
      ),
    );
  await tx
    .insert(entries)
    .values(
      admins.map((userId) => ({
        id: randomUUID(),
        groupId: e.groupId,
        userId,
        source: 'ticket' as const,
        ticketId: e.ticketId,
        title,
        workedOn: day,
        createdBy: e.actorId,
        updatedBy: e.actorId,
      })),
    )
    .onConflictDoNothing({
      target: [entries.ticketId, entries.userId],
      where: sql`${entries.ticketId} is not null`,
    });
  const requested = (
    await tx
      .select({ userId: entries.userId })
      .from(entries)
      .where(
        and(
          eq(entries.ticketId, e.ticketId),
          inArray(entries.userId, admins),
          isNull(entries.minutes),
        ),
      )
  ).map((r) => r.userId);
  const notified = requested.filter((id) => id !== e.actorId);
  const eventIds = await recordNotifications(tx, {
    kind: 'ticket.time_missing',
    groupId: e.groupId,
    recipients: notified,
    payload: {
      ticketId: e.ticketId,
      groupId: e.groupId,
      number: e.number,
      title: e.title,
      actorName: e.actorName,
    },
  });
  return {
    askActor: requested.includes(e.actorId),
    notified,
    linkedTasksLogged: await tasksLogged(tx, e.linkedTaskIds),
    groupId: e.groupId,
    changed: true,
    users: requested,
    eventIds,
  };
}

async function dropRequests(tx: Db, ticketId: string, userIds?: string[]): Promise<string[]> {
  if (userIds?.length === 0) return [];
  const rows = await tx
    .delete(entries)
    .where(
      and(
        eq(entries.ticketId, ticketId),
        isNull(entries.minutes),
        userIds ? inArray(entries.userId, userIds) : undefined,
      ),
    )
    .returning({ userId: entries.userId });
  return rows.map((r) => r.userId);
}

/** Moved out of resolved: deletes the unanswered ticket requests; returns whose went. */
export function onTicketReopened(tx: Db, ticketId: string): Promise<string[]> {
  return dropRequests(tx, ticketId);
}

/** Riešitelia removed: deletes their unanswered requests (filled time stays); whose went. */
export function onTicketAssigneesRemoved(
  tx: Db,
  ticketId: string,
  userIds: string[],
): Promise<string[]> {
  return dropRequests(tx, ticketId, userIds);
}

/**
 * The ticket moved to another client (or got its first one): its entries move with it so the
 * time stays with the ticket's client. (A ticket with tasks cannot move, so its tasks' entries
 * never need to.)
 */
export async function onTicketMoved(tx: Db, ticketId: string, groupId: string): Promise<void> {
  await tx.update(entries).set({ groupId }).where(eq(entries.ticketId, ticketId));
}

/** Before a ticket is deleted: deletes its requests (filled entries keep `title`); whose went. */
export function onTicketDeleting(tx: Db, ticketId: string): Promise<string[]> {
  return dropRequests(tx, ticketId);
}

/**
 * The ticket as the time routes read it through the tickets and tasks modules: its client,
 * number, subject, resolution (null while not resolved), riešitelia and linked tasks.
 */
export type TicketTimeSubject = {
  ticketId: string;
  groupId: string | null;
  number: number;
  title: string;
  resolvedAt: Date | null;
  assigneeIds: string[];
  linkedTasks: { taskId: string; title: string; done: boolean }[];
};

/**
 * Writes a user's own answer on a ticket: (a) minutes, or (b) "covered by the linked tasks"
 * (0 minutes, `covered_by_tasks`). A new entry of a resolved ticket counts on its resolution day;
 * an existing one keeps its day.
 */
export async function writeTicketTime(
  db: Db,
  userId: string,
  ticket: TicketTimeSubject,
  body: PutMyTicketTimeBody,
): Promise<void> {
  const covered = 'coveredByTasks' in body;
  const minutes = covered ? 0 : body.minutes;
  const title = ticketEntryTitle(ticket.number, ticket.title);
  const now = new Date();
  await db
    .insert(entries)
    .values({
      id: randomUUID(),
      groupId: ticket.groupId,
      userId,
      source: 'ticket',
      ticketId: ticket.ticketId,
      title,
      minutes,
      coveredByTasks: covered,
      workedOn: ticket.resolvedAt ? bratislavaDay(ticket.resolvedAt) : null,
      createdBy: userId,
      updatedBy: userId,
      filledAt: now,
    })
    .onConflictDoUpdate({
      target: [entries.ticketId, entries.userId],
      targetWhere: sql`${entries.ticketId} is not null`,
      set: {
        minutes,
        coveredByTasks: covered,
        title,
        groupId: ticket.groupId,
        workedOn: sql`coalesce(${entries.workedOn}, excluded.worked_on)`,
        updatedBy: userId,
        updatedAt: now,
        filledAt: now,
      },
    });
}

/**
 * `GET /api/tickets/:id/time`: the caller's own entry (null unless `canLogOwnTicketTime`), the
 * linked tasks with only the caller's own minutes, whether any linked task has logged time (yes
 * or no), and for a finance admin every admin riešiteľ's time. Two queries, three for finance.
 */
export async function getTicketTime(
  db: Db,
  actor: SessionUser,
  ticket: TicketTimeSubject,
): Promise<TicketTimeDto> {
  const finance = canSeeFinance(actor);
  const taskIds = ticket.linkedTasks.map((t) => t.taskId);
  const [own, mineOnTasks, logged] = await Promise.all([
    db
      .select({
        userId: entries.userId,
        minutes: entries.minutes,
        workedOn: entries.workedOn,
        coveredByTasks: entries.coveredByTasks,
      })
      .from(entries)
      .where(
        and(
          eq(entries.ticketId, ticket.ticketId),
          finance ? undefined : eq(entries.userId, actor.id),
        ),
      ),
    taskIds.length === 0
      ? []
      : db
          .select({ taskId: entries.taskId, minutes: entries.minutes })
          .from(entries)
          .where(and(inArray(entries.taskId, taskIds), eq(entries.userId, actor.id))),
    tasksLogged(db, taskIds),
  ]);
  const byUser = new Map(own.map((r) => [r.userId, r]));
  const state = (userId: string) => {
    const row = byUser.get(userId);
    return {
      minutes: row?.minutes ?? null,
      requested: row !== undefined && row.minutes === null && row.workedOn !== null,
      coveredByTasks: row?.coveredByTasks ?? false,
    };
  };
  const minutesOnTask = new Map(mineOnTasks.map((r) => [r.taskId, r.minutes]));
  const dto: TicketTimeDto = {
    mine: canLogOwnTicketTime(actor, ticket) ? state(actor.id) : null,
    linkedTasks: ticket.linkedTasks.map((t) => ({
      ...t,
      mine: minutesOnTask.get(t.taskId) ?? null,
    })),
    linkedTasksLogged: logged,
  };
  if (!finance) return dto;
  const admins = await adminIdsAmong(db, ticket.assigneeIds);
  const ids = [...new Set([...admins, ...own.map((r) => r.userId)])];
  const names = await getUserNames(db, ids);
  dto.assignees = ids
    .map((userId) => ({ userId, name: names.get(userId) ?? '', ...state(userId) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'sk') || a.userId.localeCompare(b.userId));
  return dto;
}

/** `PUT /api/tickets/:id/time/me`: (a) minutes, or (b) covered by the linked tasks. */
export async function fillTicketTime(
  deps: { db: Db; io: SocketIOServer },
  actor: SessionUser,
  ticket: TicketTimeSubject,
  body: PutMyTicketTimeBody,
): Promise<TicketTimeDto> {
  await writeTicketTime(deps.db, actor.id, ticket, body);
  await announceTimeChange(deps.db, deps.io, {
    groupId: ticket.groupId,
    changed: true,
    users: [actor.id],
    eventIds: [],
  });
  return getTicketTime(deps.db, actor, ticket);
}
