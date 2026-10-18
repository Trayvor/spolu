import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  ActiveCardsSchema,
  EventItemsPageSchema,
  TimelineResponseSchema,
  type EventItemsQuery,
} from '@spolu/shared';
import { apiGet } from '@/lib/api';
import { projectsKey } from './api';

/**
 * The Prehľad tab's reads of part P4 (spec §7.3, §7.4), under the projects prefix, so a
 * `project:changed` refetches them with the rest (`useProjectEvents`), and task and ticket
 * events refetch them too (`useWorkEvents`).
 */

const enc = encodeURIComponent;

/** One page of the timeline: around today, or the next one before or after a cursor. */
export type TimelinePageParam = { before?: string; after?: string };

/** `null` project: all active projects. */
export const timelinePageQuery = (
  groupId: string,
  project: string | null,
  param: TimelinePageParam,
) =>
  queryOptions({
    queryKey: projectsKey(groupId, 'timeline', project ?? 'all', param),
    queryFn: () => {
      const params = new URLSearchParams();
      if (project) params.set('project', project);
      if (param.before) params.set('before', param.before);
      if (param.after) params.set('after', param.after);
      const query = params.size > 0 ? `?${params}` : '';
      return apiGet(`/groups/${enc(groupId)}/timeline${query}`, TimelineResponseSchema);
    },
  });

/** An event's open tasks, open tickets or done pile, 20 a page (the sheet, the pile). */
export const eventItemsQuery = (groupId: string, eventId: string, kind: EventItemsQuery['kind']) =>
  infiniteQueryOptions({
    queryKey: projectsKey(groupId, 'items', eventId, kind),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ kind });
      if (pageParam) params.set('after', pageParam);
      return apiGet(`/project-events/${enc(eventId)}/items?${params}`, EventItemsPageSchema);
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

/** The Tickets and Tasks cards, one request. */
export const activeCardsQuery = (groupId: string) =>
  queryOptions({
    queryKey: projectsKey(groupId, 'active'),
    queryFn: () => apiGet(`/groups/${enc(groupId)}/overview/active`, ActiveCardsSchema),
  });
