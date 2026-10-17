/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { TimelineTicketRow } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from '../projects/errors.js';

/**
 * The tickets under each timeline event (Phase 33 part P4, spec §3.1): up to `openLimit` open
 * tickets per event (`row_number() over (partition by event_id …)` on
 * `tickets_event_project_idx`) and the open and resolved counts. Stub written by P1.
 */
export async function ticketsByEvents(
  _db: Db,
  _groupId: string,
  _eventIds: string[],
  _opts: { openLimit: number },
): Promise<Map<string, { open: TimelineTicketRow[]; openCount: number; doneCount: number }>> {
  throw new NotImplementedError('ticketsByEvents (Phase 33 part P4)');
}
