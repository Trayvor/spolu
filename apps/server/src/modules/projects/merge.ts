/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { ProjectDto, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { NotImplementedError } from './errors.js';

/**
 * Merges project `fromId` into `intoId` of the same client (Phase 33 part P3, spec §5.6), in one
 * transaction under `lockGroupProjects`: events (their tasks and tickets follow through the
 * event FK's `on update cascade`), the other tasks and tickets (`reassignTaskProject`,
 * `reassignTicketProject`), files, linked knowledge, pending eGrant changes and every key row
 * move to the survivor; `runProjectMergeHooks(tx, { groupId, fromProjectId, intoProjectId })`
 * (`merge-hooks.ts`, Phase 33 P6) then moves the copies other modules keep (finance's time
 * entries and contracts); then `fromId` is deleted. Stub written by P1; P3 adds
 * `POST /api/projects/:id/merge` (`canMergeOrDeleteProject`).
 */
export async function mergeProjects(
  _deps: { db: Db; storage: Storage },
  _actor: SessionUser,
  _fromId: string,
  _intoId: string,
): Promise<ProjectDto> {
  throw new NotImplementedError('mergeProjects (Phase 33 part P3)');
}
