import type { NotificationKind } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { recordNotifications, requestDelivery } from '../notifications/service.js';
import { clearTicketUnseenForAdmins } from '../notifications/unseen.js';
import {
  hasAssignees,
  ticketAssigneeIds,
  ticketAudienceIds,
  ticketOwnerIds,
  ticketResolvedAudienceIds,
} from './audience.js';
import { getActiveRoles } from '../users/service.js';
import { onTicketChange, type TicketChange } from './hooks.js';
import { readingIds, type TicketRow } from './service.js';
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
 * Who hears about a ticket change, and as which kind (owner decision 2026-10-17, ADR 0021
 * amendment). A new ticket (also one that gets or changes its client) goes, while it has no
 * riešiteľ, to the people who watch the client's tickets (`watch.ts`) as `ticket.created`, or
 * without a client to every active admin as `ticket.unassigned` (`groupId` null); one that
 * already has riešitelia goes to them as `ticket.updated`. Status, field and task changes go to
 * `ticketAudienceIds`: the riešitelia, or the watchers (every admin without a client) while it has
 * none, and the initiator. Resolving is `ticket.resolved` (2026-10-18) to that audience and the
 * watchers too (`ticketResolvedAudienceIds`). A new riešiteľ hears `ticket.assigned`.
 */
async function audience(
  deps: AppDeps,
  change: TicketChange,
): Promise<{ kind: NotificationKind; recipients: string[]; extra: Record<string, unknown> }> {
  const { ticket } = change;
  switch (change.kind) {
    case 'created':
    case 'moved': {
      const owners = await ticketOwnerIds(deps.db, ticket);
      const kind: NotificationKind = (await hasAssignees(deps.db, ticket.id))
        ? 'ticket.updated'
        : ticket.groupId === null
          ? 'ticket.unassigned'
          : 'ticket.created';
      return { kind, recipients: owners, extra: {} };
    }
    case 'status':
      if (ticket.status === 'resolved') {
        // 2026-10-18 (UX review N5h): the outcome also reaches the people who watch the client's
        // tickets, though a riešiteľ answers it, so a client who followed it hears it was solved.
        return {
          kind: 'ticket.resolved',
          recipients: await ticketResolvedAudienceIds(deps.db, ticket),
          extra: { status: ticket.status },
        };
      }
      return {
        kind: 'ticket.status',
        recipients: await ticketAudienceIds(deps.db, ticket),
        extra: { status: ticket.status },
      };
    case 'updated':
      return {
        kind: 'ticket.updated',
        recipients: await ticketAudienceIds(deps.db, ticket),
        extra: {},
      };
    case 'tasks':
      return {
        kind: 'ticket.tasks',
        recipients: await ticketAudienceIds(deps.db, ticket),
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
  if (change.kind === 'assigned' && change.ticket.groupId === null) {
    // 2026-10-17: every admin heard about the ticket without a client; once it has its first
    // riešiteľ nobody else needs to look, so it is seen for all of them (the new riešiteľ's
    // `ticket.assigned`, recorded next, still counts for them).
    const assignees = await ticketAssigneeIds(deps.db, change.ticket.id);
    if (assignees.length === 1) await clearTicketUnseenForAdmins(deps.db, change.ticket.id);
  }
  // Getting a first client comes as `created` with `previousGroupId` null (a new ticket from the
  // intake has none at all).
  if (change.previousGroupId === null && change.ticket.groupId !== null) {
    // 2026-10-18 (UX review X35): a ticket without a client that gets one is the new client's
    // watchers' now; the other admins' "new ticket without a client" mark goes. The watchers'
    // `ticket.created`, recorded next, still counts for them.
    await clearTicketUnseenForAdmins(deps.db, change.ticket.id);
  }
  const { kind, recipients, extra } = await audience(deps, change);
  const recorded = await recordNotifications(deps.db, {
    kind,
    groupId: change.ticket.groupId,
    recipients: recipients.filter((id) => id !== change.actorId),
    payload: { ...ticketPayload(change.ticket), ...extra },
  });
  await requestDelivery(deps.jobs, recorded);
}

/** Tells watchers, riešitelia, initiators and admins about ticket changes. Call once at start-up. */
export function registerTicketNotifications(): void {
  onTicketChange(notifyTicketChange);
}

/** The active admins among these users (one query). */
async function adminsAmong(deps: AppDeps, ids: string[]): Promise<string[]> {
  const roles = await getActiveRoles(deps.db, ids);
  return ids.filter((id) => roles.get(id) === 'admin' || roles.get(id) === 'superadmin');
}

/**
 * A 👎 rating (2026-10-19), once per rating (the caller checks `turnedDown`): to the admins among
 * the ticket's owners (`ticketOwnerIds`), else to the admins who watch its client's tickets; only
 * people who still read it, never the rater. A ticket without a client notifies nobody. The
 * payload is the ticket's fields and the value, never the comment.
 */
export async function notifyTicketRated(
  deps: AppDeps,
  ticket: TicketRow,
  raterId: string,
): Promise<void> {
  if (ticket.groupId === null) return;
  let recipients = await adminsAmong(deps, await ticketOwnerIds(deps.db, ticket));
  if (recipients.length === 0) {
    const watchers = await ticketWatcherIds(deps.db, ticket.groupId);
    recipients = await readingIds(deps.db, ticket, await adminsAmong(deps, watchers));
  }
  const recorded = await recordNotifications(deps.db, {
    kind: 'ticket.rated',
    groupId: ticket.groupId,
    recipients: recipients.filter((id) => id !== raterId),
    payload: { ...ticketPayload(ticket), value: 'down' },
  });
  await requestDelivery(deps.jobs, recorded);
}
