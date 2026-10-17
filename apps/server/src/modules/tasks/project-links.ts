/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from '../projects/errors.js';

/**
 * Moves the client's tasks of project `fromProjectId` (those without an event; tasks on an
 * event follow the event through its FK's `on update cascade`) to `toProjectId`, in the merge's
 * transaction (Phase 33, spec §3.1). Stub written by P1; parts P2 or P3 fill it, the one that
 * merges first.
 */
export async function reassignTaskProject(
  _tx: Db,
  _groupId: string,
  _fromProjectId: string,
  _toProjectId: string,
): Promise<void> {
  throw new NotImplementedError('reassignTaskProject (Phase 33 part P2/P3)');
}
