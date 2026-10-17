/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { TimelineTaskRow } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from '../projects/errors.js';

/**
 * The tasks under each timeline event (Phase 33 part P4, spec §3.1): up to `openLimit` open
 * tasks per event (one query with `row_number() over (partition by event_id …)` on
 * `tasks_event_project_idx`) and the open and done counts (one grouped count). Stub written by P1.
 */
export async function tasksByEvents(
  _db: Db,
  _groupId: string,
  _eventIds: string[],
  _opts: { openLimit: number },
): Promise<Map<string, { open: TimelineTaskRow[]; openCount: number; doneCount: number }>> {
  throw new NotImplementedError('tasksByEvents (Phase 33 part P4)');
}
