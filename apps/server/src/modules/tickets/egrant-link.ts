/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from '../projects/errors.js';
import type { TicketRow } from './service.js';

/**
 * The intake's `project_id` link (Phase 33 part P3, spec §5.5). Stubs written by P1.
 */

/**
 * Links a new or re-assigned ticket to its client's project with this eGrant id, once and only
 * on a ticket without a project; keeps the raw id (`tickets.egrant_project_id`) when the
 * project has not arrived or the ticket has no client. Never sets an event.
 */
export async function linkTicketProject(
  _tx: Db,
  _ticket: TicketRow,
  _egrantProjectId: string | null,
): Promise<'linked' | 'waiting' | 'none'> {
  throw new NotImplementedError('linkTicketProject (Phase 33 part P3)');
}

/**
 * Links the client's tickets waiting for this eGrant project (one update on
 * `tickets_waiting_project_idx`); returns their ids for `ticket:updated`.
 */
export async function linkWaitingTickets(
  _tx: Db,
  _groupId: string,
  _egrantProjectId: string,
  _projectId: string,
): Promise<string[]> {
  throw new NotImplementedError('linkWaitingTickets (Phase 33 part P3)');
}
