/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { ActiveTicketRow } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from '../projects/errors.js';

/**
 * The overview's Tickets card (Phase 33 part P4, spec §7.4): the client's New and In progress
 * tickets, those the user is a riešiteľ of first, then newest first; with the totals. Stub
 * written by P1.
 */
export async function activeTicketsOf(
  _db: Db,
  _groupId: string,
  _userId: string,
  _limit: number,
): Promise<{ rows: ActiveTicketRow[]; total: number; mine: number }> {
  throw new NotImplementedError('activeTicketsOf (Phase 33 part P4)');
}
