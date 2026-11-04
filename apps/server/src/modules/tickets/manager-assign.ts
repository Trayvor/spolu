import type { Db } from '../../infra/db/client.js';
import { systemActor } from '../audit/actor.js';
import { listManagerIdsOldestFirst } from '../groups/managers.js';
import { ticketAssigneeIds } from './audience.js';
import { addAssignee, InvalidTicketAssigneeError, type TicketRow } from './service.js';

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
