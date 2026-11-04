import { and, eq, inArray, notExists } from 'drizzle-orm';
import type { Db } from '../../infra/db/client.js';
import { systemActor } from '../audit/actor.js';
import { listManagerIdsOldestFirst, onManagerGained } from '../groups/managers.js';
import { recordManyNotifications } from '../notifications/service.js';
import { ticketAssigneeIds } from './audience.js';
import { ticketPayload } from './notify.js';
import { tickets, ticketAssignees } from './schema.js';
import {
  addAssignee,
  InvalidTicketAssigneeError,
  MAX_TICKET_ASSIGNEES,
  type TicketRow,
} from './service.js';

/**
 * The client's managers become riešitelia of its tickets (ticket lifecycle rework, design 4.1).
 * The author of the automatic assignment in the audit log.
 */
export const MANAGER_ASSIGN_ACTOR = 'tickets.manager-autoassign';

/**
 * Makes the ticket's client's active managers riešitelia, earliest appointed first, up to the
 * limit of riešitelia. `created`: every manager who is not one yet. `ifNone` (the ticket got or
 * changed its client): only while the ticket has no riešiteľ. Each add is the manual one
 * (`addAssignee`: audited as `ticket.assignee_added` by the system actor); the caller runs the
 * `assigned` hooks for the returned ids. A ticket without a client gets nobody.
 */
export async function assignManagers(
  db: Db,
  ticket: TicketRow,
  mode: 'created' | 'ifNone',
): Promise<string[]> {
  if (ticket.groupId === null) return [];
  const managers = await listManagerIdsOldestFirst(db, ticket.groupId);
  if (managers.length === 0) return [];
  const current = await ticketAssigneeIds(db, ticket.id);
  if (mode === 'ifNone' && current.length > 0) return [];
  const by = systemActor(MANAGER_ASSIGN_ACTOR);
  const added: string[] = [];
  for (const id of managers) {
    if (current.length + added.length >= MAX_TICKET_ASSIGNEES) break;
    if (current.includes(id)) continue;
    try {
      if (await addAssignee(db, ticket, id, by)) added.push(id);
    } catch (error) {
      // The ticket is full of riešitelia, or the admin left meanwhile: skipped.
      if (error instanceof InvalidTicketAssigneeError) continue;
      throw error;
    }
  }
  return added;
}

/**
 * A user became a manager of the group (design 4.1): they become a riešiteľ of its open tickets
 * that have none, with `ticket.assigned` recorded (the minute sweep delivers it). Runs inside the
 * caller's transaction `tx`; the earlier riešitelia of a ticket are never touched.
 */
export async function assignNewManager(tx: Db, groupId: string, userId: string): Promise<void> {
  const open = await tx
    .select()
    .from(tickets)
    .where(
      and(
        eq(tickets.groupId, groupId),
        inArray(tickets.status, ['new', 'in_progress']),
        notExists(
          tx
            .select({ one: ticketAssignees.userId })
            .from(ticketAssignees)
            .where(eq(ticketAssignees.ticketId, tickets.id)),
        ),
      ),
    );
  const by = systemActor(MANAGER_ASSIGN_ACTOR);
  const events = [];
  for (const ticket of open) {
    if (!(await addAssignee(tx, ticket, userId, by))) continue;
    events.push({
      kind: 'ticket.assigned' as const,
      groupId,
      recipients: [userId],
      payload: ticketPayload(ticket),
    });
  }
  if (events.length > 0) await recordManyNotifications(tx, events);
}

/** Registers `assignNewManager`; called at start-up, safe to repeat. */
export function registerManagerAssign(): void {
  onManagerGained(assignNewManager);
}
