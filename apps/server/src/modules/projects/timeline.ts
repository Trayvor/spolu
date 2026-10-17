/* eslint-disable @typescript-eslint/no-unused-vars -- a Phase 33 stub: the part that fills it removes this line. */
import type {
  EventItemsPage,
  EventItemsQuery,
  TimelineQuery,
  TimelineResponse,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { NotImplementedError } from './errors.js';

/**
 * The timeline (Phase 33 part P4, spec §7.3). Stub written by P1 with the interface P4 fills:
 * `GET /api/groups/:id/timeline` (keyset around today both ways, six queries a page through
 * `tasksByEvents`, `ticketsByEvents`, `projectRefs` and one names batch) and
 * `GET /api/project-events/:id/items` (20 a page). P4 registers the routes in its own file.
 */

export async function getTimeline(
  _db: Db,
  _groupId: string,
  _query: TimelineQuery,
): Promise<TimelineResponse> {
  throw new NotImplementedError('getTimeline (Phase 33 part P4)');
}

export async function eventItems(
  _db: Db,
  _eventId: string,
  _query: EventItemsQuery,
): Promise<EventItemsPage> {
  throw new NotImplementedError('eventItems (Phase 33 part P4)');
}
