/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type { EgrantProjectBody, EgrantReviewBody, ProjectDto, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import type { Storage } from '../../infra/storage/storage.js';
import { NotImplementedError } from './errors.js';

/**
 * eGrant project deliveries and their review (Phase 33 part P3, spec §5.1–§5.4). Stubs written
 * by P1 with the interfaces P3 fills; P3 adds the endpoint in `egrant-routes.ts`.
 */

export type DeliveryResult = {
  projectId: string;
  state: 'created' | 'unchanged' | 'pending' | 'stale';
  /** Pending changes after the delivery. */
  pending: number;
  /** The skipped events, as `events[2].date`. */
  skipped: string[];
};

/**
 * Processes one delivery of the project endpoint for a client, in the caller's transaction under
 * `lockGroupProjects`: creates the project with its events on the first one (and links the
 * client's waiting tickets through the tickets module's `linkWaitingTickets`), else records the
 * differences as pending changes.
 */
export async function receiveProjectDelivery(
  _tx: Db,
  _groupId: string,
  _egrantProjectId: string,
  _body: EgrantProjectBody,
): Promise<DeliveryResult> {
  throw new NotImplementedError('receiveProjectDelivery (Phase 33 part P3)');
}

/**
 * Processes the stored deliveries of an eGrant instance host for a client that now has its URL
 * (called by the groups service on client create and URL change), and deletes them.
 */
export async function processInboxFor(_tx: Db, _groupId: string, _host: string): Promise<void> {
  throw new NotImplementedError('processInboxFor (Phase 33 part P3)');
}

/** Applies the accepted pending changes of a project and marks the dismissed ones. */
export async function reviewEgrantChanges(
  _deps: { db: Db; storage: Storage },
  _actor: SessionUser,
  _projectId: string,
  _review: EgrantReviewBody,
): Promise<ProjectDto> {
  throw new NotImplementedError('reviewEgrantChanges (Phase 33 part P3)');
}
