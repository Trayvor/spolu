import { sql, type SQL } from 'drizzle-orm';
import type { NotificationKind } from '@spolu/shared';

/**
 * The notification kinds that count as an unseen change of a task or a ticket (2026-10-17, see
 * docs/superpowers/specs/2026-10-17-unseen-changes-design.md). Not `task.urgent` (hourly) nor
 * `reminder.due`, nor a task's time request. Kept apart from `unseen.ts` so the schema can build
 * its partial indexes from the same lists without an import cycle.
 */
export const TASK_UNSEEN_KINDS = [
  'task.assigned',
  'task.moved',
  'task.deadline',
  // 2026-10-18: the due date changed, the task is overdue.
  'task.due_changed',
  'task.overdue',
  // In a task chat (the payload's `taskId` is set; a group chat's is null).
  'chat.message',
  'chat.mention',
  'chat.thread_reply',
  // 2026-10-18: a mention in the task's description (a project's has no `taskId`).
  'description.mention',
] as const satisfies readonly NotificationKind[];

export const TICKET_UNSEEN_KINDS = [
  'ticket.created',
  'ticket.unassigned',
  'ticket.message',
  'ticket.status',
  'ticket.updated',
  'ticket.tasks',
  'ticket.assigned',
  'ticket.time_missing',
  // 2026-10-18.
  'ticket.resolved',
  // A mention in a ticket chat carries the ticket.
  'chat.mention',
  // 2026-10-18: a mention in the ticket's text.
  'description.mention',
] as const satisfies readonly NotificationKind[];

/**
 * Of those, the messages in the item's chat (2026-10-18): an unseen one marks the item with a
 * ring, not a plain dot.
 */
export const TASK_MESSAGE_KINDS = [
  'chat.message',
  'chat.mention',
  'chat.thread_reply',
] as const satisfies readonly (typeof TASK_UNSEEN_KINDS)[number][];

export const TICKET_MESSAGE_KINDS = [
  'ticket.message',
  'chat.mention',
] as const satisfies readonly (typeof TICKET_UNSEEN_KINDS)[number][];

// Literals, not bind parameters: the planner must see the same constants as the partial index.
export const list = (kinds: readonly string[]) => sql.raw(kinds.map((k) => `'${k}'`).join(', '));

/** Rows of `notification_events` that may be a task's unseen change (the partial index's). */
export function taskUnseenPredicate(kind: SQL, payload: SQL): SQL {
  return sql`(${kind} in (${list(TASK_UNSEEN_KINDS)}) and (${payload} ->> 'taskId') is not null)`;
}

/** Rows of `notification_events` that may be a ticket's unseen change. */
export function ticketUnseenPredicate(kind: SQL, payload: SQL): SQL {
  return sql`(${kind} in (${list(TICKET_UNSEEN_KINDS)}) and (${payload} ->> 'ticketId') is not null)`;
}
