/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures until part A2 fills them */
import type { Server as SocketIOServer } from 'socket.io';
import type { PutMyTicketTimeBody, SessionUser, TicketTimeDto } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';

/**
 * Time on a resolved ticket (Phase 32, spec §5.6, the 2026-10-17 extension): the hooks the
 * tickets module calls inside its own transactions. Part A2 owns this file and replaces the
 * stubs. It must not import `modules/tickets` (the tickets module imports it): everything it
 * needs comes in the arguments. A ticket without a client asks no time (spec §5.6).
 */

const notImplemented = (): never => {
  throw new Error('not implemented (Phase 32 part A2)');
};

/** A ticket's status became `resolved` (from another status). */
export type TicketResolvedEvent = {
  ticketId: string;
  /** Null: a ticket without a client — no request, no entry. */
  groupId: string | null;
  title: string;
  resolvedAt: Date;
  actorId: string;
  /**
   * The ticket's riešitelia (`ticket_assignees`, as `modules/tickets/audience.ts` reads them);
   * only the active admins among them are asked, never client watchers.
   */
  assigneeIds: string[];
  /** The tasks made from the ticket (`tasks.source_ticket_id`). */
  linkedTaskIds: string[];
};

/**
 * Inserts requested ticket entries for the admin riešitelia without one (or dates entries filled
 * before), records the time request notification for each except the actor. `askActor`: the
 * actor is an admin riešiteľ whose entry is requested (the status answer's `askTime`);
 * `linkedTasksLogged`: a linked task is done with filled time, so the dialog offers option (b).
 */
export async function onTicketResolved(
  _tx: Db,
  _e: TicketResolvedEvent,
): Promise<{ askActor: boolean; notified: string[]; linkedTasksLogged: boolean }> {
  return notImplemented();
}

/** Moved out of resolved: deletes the unanswered ticket requests; returns whose went. */
export async function onTicketReopened(_tx: Db, _ticketId: string): Promise<string[]> {
  return notImplemented();
}

/** Riešitelia removed: deletes their unanswered requests (filled time stays). */
export async function onTicketAssigneesRemoved(
  _tx: Db,
  _ticketId: string,
  _userIds: string[],
): Promise<void> {
  return notImplemented();
}

/**
 * The ticket moved to another client (or got its first one): its entries, and the entries of
 * its linked tasks' unit, move with it so the time stays with the ticket's client.
 */
export async function onTicketMoved(_tx: Db, _ticketId: string, _groupId: string): Promise<void> {
  return notImplemented();
}

/** Before a ticket is deleted: deletes its requests (filled entries keep `title`); whose went. */
export async function onTicketDeleting(_tx: Db, _ticketId: string): Promise<string[]> {
  return notImplemented();
}

/** `GET /api/tickets/:id/time`: the caller's own time only, unless `canSeeFinance`. */
export async function getTicketTime(
  _db: Db,
  _actor: SessionUser,
  _ticketId: string,
): Promise<TicketTimeDto> {
  return notImplemented();
}

/** `PUT /api/tickets/:id/time/me`: (a) minutes, or (b) covered by the linked tasks. */
export async function fillTicketTime(
  _deps: { db: Db; io: SocketIOServer },
  _actor: SessionUser,
  _ticketId: string,
  _body: PutMyTicketTimeBody,
): Promise<TicketTimeDto> {
  return notImplemented();
}
