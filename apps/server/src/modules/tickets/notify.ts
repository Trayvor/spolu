import type { NotificationKind } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { recordNotifications, requestDelivery } from '../notifications/service.js';
import { listAdmins } from '../users/service.js';
import { onTicketChange, type TicketChange } from './hooks.js';
import { readingFollowerIds, type TicketRow } from './service.js';
import { ticketWatcherIds } from './watch.js';

/** What every ticket event carries: enough for its push, its digest line and its link. */
export function ticketPayload(ticket: TicketRow): Record<string, unknown> {
  return {
    ticketId: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    groupId: ticket.groupId,
  };
}

/**
 * Who hears about a ticket change, and as which kind. A new ticket (also one that gets or changes
 * its client) goes to the people who watch the client's tickets (`watch.ts`) as
 * `ticket.created`; without a client to every active admin as `ticket.unassigned` (`groupId`
 * null). Status, field and task changes go to the followers who can still read the ticket (the
 * riešitelia follow it). A new riešiteľ hears `ticket.assigned`.
 */
async function audience(
  deps: AppDeps,
  change: TicketChange,
): Promise<{ kind: NotificationKind; recipients: string[]; extra: Record<string, unknown> }> {
  const { ticket } = change;
  switch (change.kind) {
    case 'created':
    case 'moved':
      return ticket.groupId === null
        ? {
            kind: 'ticket.unassigned',
            recipients: (await listAdmins(deps.db)).map((a) => a.id),
            extra: {},
          }
        : {
            kind: 'ticket.created',
            recipients: await ticketWatcherIds(deps.db, ticket.groupId),
            extra: {},
          };
    case 'status':
      return {
        kind: 'ticket.status',
        recipients: await readingFollowerIds(deps.db, ticket),
        extra: { status: ticket.status },
      };
    case 'updated':
      return {
        kind: 'ticket.updated',
        recipients: await readingFollowerIds(deps.db, ticket),
        extra: {},
      };
    case 'tasks':
      return {
        kind: 'ticket.tasks',
        recipients: await readingFollowerIds(deps.db, ticket),
        extra: { count: change.count ?? 0 },
      };
    case 'assigned':
      return {
        kind: 'ticket.assigned',
        recipients: change.assigneeId ? [change.assigneeId] : [],
        extra: {},
      };
  }
}

/**
 * Records the notification events of a committed ticket change (never for its actor) and asks
 * for their delivery. The messages of the ticket chat notify through the chat module
 * (`messageNotice` in `chat.ts`).
 */
export async function notifyTicketChange(deps: AppDeps, change: TicketChange): Promise<void> {
  const { kind, recipients, extra } = await audience(deps, change);
  const recorded = await recordNotifications(deps.db, {
    kind,
    groupId: change.ticket.groupId,
    recipients: recipients.filter((id) => id !== change.actorId),
    payload: { ...ticketPayload(change.ticket), ...extra },
  });
  await requestDelivery(deps.jobs, recorded);
}

/** Tells followers, watchers, riešitelia and admins about ticket changes. Call once at start-up. */
export function registerTicketNotifications(): void {
  onTicketChange(notifyTicketChange);
}
