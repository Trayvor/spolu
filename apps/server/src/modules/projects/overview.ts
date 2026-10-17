/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { ActiveCards } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from './errors.js';

/**
 * The overview's active cards (Phase 33 part P4, spec §7.4). Stub written by P1:
 * `GET /api/groups/:id/overview/active`, built from the tasks and tickets modules' `openTasksOf`
 * and `activeTicketsOf` ("mine" first, 8 rows each).
 */
export async function getActiveCards(
  _db: Db,
  _groupId: string,
  _userId: string,
): Promise<ActiveCards> {
  throw new NotImplementedError('getActiveCards (Phase 33 part P4)');
}
