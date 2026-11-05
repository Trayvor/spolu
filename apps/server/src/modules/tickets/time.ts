import type { Db } from '../../infra/db/client.js';
import { droppedRequests, noTimeEffect, type TimeEffect } from '../finance/task-time.js';
import {
  dateFilledTicketTime,
  onTicketDone,
  onTicketReopened,
  requestTicketTimeReview,
} from '../finance/ticket-time.js';
import { listTasksFromTicket } from '../tasks/task-service.js';
import { ticketAssigneeIds } from './audience.js';
import type { TicketRow } from './service.js';

type TimeActor = { id: string; name: string };

/** Asks the admin riešitelia (`ticketAssigneeIds`, never clients), or asks for a review. */
async function askTicketTime(
  tx: Db,
  actor: TimeActor,
  ticket: TicketRow,
  doneAt: Date,
  review: boolean,
): Promise<TimeEffect> {
  const [assigneeIds, linked] = await Promise.all([
    ticketAssigneeIds(tx, ticket.id),
    listTasksFromTicket(tx, ticket.id),
  ]);
  const done = {
    ticketId: ticket.id,
    groupId: ticket.groupId,
    number: ticket.number,
    title: ticket.subject ?? '',
    doneAt,
    actorId: actor.id,
    actorName: actor.name,
    assigneeIds,
    linkedTaskIds: linked.map((t) => t.id),
    projectId: ticket.projectId,
    eventId: ticket.eventId,
  };
  const asked = review ? await requestTicketTimeReview(tx, done) : await onTicketDone(tx, done);
  return { askTime: asked.askActor, time: asked };
}

/**
 * Time on a press of "Solved on our side" (design 5.4), inside its transaction: the first asks, a
 * press after a cleared mark asks for a review. `before` is the row before the press, which clears
 * `adminDoneClearedAt`; `doneAt` the press's time.
 */
export function ticketDoneTime(
  tx: Db,
  actor: TimeActor,
  before: TicketRow,
  doneAt: Date,
): Promise<TimeEffect> {
  return askTicketTime(tx, actor, before, doneAt, before.adminDoneClearedAt !== null);
}

/**
 * Time on a status change (Phase 32, design 5.4), inside its transaction. `before` is the row as
 * read: the change resets the mark fields. A ticket becoming `resolved` with the mark set was asked
 * at the press, so nobody is asked again, whoever resolves it (the job has no `actor`). After a
 * cleared mark it asks for a review; otherwise it asks as a press does. Leaving `resolved` drops
 * the unanswered requests. Finance decides who is asked and whether a ticket without a client asks
 * anything (decision 24).
 */
export async function ticketStatusTime(
  tx: Db,
  actor: TimeActor | null,
  before: TicketRow,
  after: TicketRow,
): Promise<TimeEffect> {
  if (after.status === 'resolved' && before.status !== 'resolved') {
    const resolvedAt = after.resolvedAt ?? new Date();
    if (before.adminDoneAt) {
      await dateFilledTicketTime(tx, after.id, resolvedAt);
      return noTimeEffect(after.groupId);
    }
    if (!actor) return noTimeEffect(after.groupId);
    return askTicketTime(tx, actor, after, resolvedAt, before.adminDoneClearedAt !== null);
  }
  if (before.status === 'resolved' && after.status !== 'resolved') {
    return {
      askTime: false,
      time: droppedRequests(after.groupId, await onTicketReopened(tx, after.id)),
    };
  }
  return noTimeEffect(after.groupId);
}
