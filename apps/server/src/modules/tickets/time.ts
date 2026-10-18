import type { Db } from '../../infra/db/client.js';
import { droppedRequests, noTimeEffect, type TimeEffect } from '../finance/task-time.js';
import { onTicketReopened, onTicketResolved } from '../finance/ticket-time.js';
import { listTasksFromTicket } from '../tasks/task-service.js';
import { ticketAssigneeIds } from './audience.js';
import type { TicketRow } from './service.js';

/**
 * Time on a resolved ticket (Phase 32, spec §5.6), inside the status change's transaction: a
 * ticket becoming `resolved` asks its admin riešitelia (`ticketAssigneeIds`, never client
 * watchers) for their time; leaving `resolved` drops the unanswered requests. Finance decides
 * who is asked and whether a ticket without a client asks anything (decision 24).
 */
export async function ticketStatusTime(
  tx: Db,
  actor: { id: string; name: string } | null,
  before: TicketRow,
  after: TicketRow,
): Promise<TimeEffect> {
  if (after.status === 'resolved' && before.status !== 'resolved' && actor) {
    const [assigneeIds, linked] = await Promise.all([
      ticketAssigneeIds(tx, after.id),
      listTasksFromTicket(tx, after.id),
    ]);
    const asked = await onTicketResolved(tx, {
      ticketId: after.id,
      groupId: after.groupId,
      number: after.number,
      title: after.subject ?? '',
      resolvedAt: after.resolvedAt ?? new Date(),
      actorId: actor.id,
      actorName: actor.name,
      assigneeIds,
      linkedTaskIds: linked.map((t) => t.id),
      projectId: after.projectId,
      eventId: after.eventId,
    });
    return { askTime: asked.askActor, time: asked };
  }
  if (before.status === 'resolved' && after.status !== 'resolved') {
    return {
      askTime: false,
      time: droppedRequests(after.groupId, await onTicketReopened(tx, after.id)),
    };
  }
  return noTimeEffect(after.groupId);
}
