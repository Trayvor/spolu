/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { ActiveTaskRow } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from '../projects/errors.js';

/**
 * The overview's Tasks card (Phase 33 part P4, spec §7.4): the client's tasks not in Completed,
 * the user's own first, then urgent, then by deadline; with the totals. Stub written by P1.
 */
export async function openTasksOf(
  _db: Db,
  _groupId: string,
  _userId: string,
  _limit: number,
): Promise<{ rows: ActiveTaskRow[]; total: number; mine: number; urgent: number }> {
  throw new NotImplementedError('openTasksOf (Phase 33 part P4)');
}
