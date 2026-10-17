/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from './errors.js';

/**
 * Matching eGrant's project id in a client (Phase 33 part P3, spec §5.5). Stub written by P1.
 * A ticket's link goes by the eGrant id only (the `egrant_id` key row of `project_name_keys`),
 * archived projects included; null when the client has no such project yet.
 */
export async function findEgrantProject(
  _tx: Db,
  _groupId: string,
  _egrantProjectId: string,
): Promise<string | null> {
  throw new NotImplementedError('findEgrantProject (Phase 33 part P3)');
}
