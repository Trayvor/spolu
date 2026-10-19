import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  TicketRatingListSchema,
  TicketRatingSummarySchema,
  type TicketRatingDays,
  type TicketRatingValue,
} from '@spolu/shared';
import { apiGet } from '@/lib/api';

/**
 * The ratings queries for admins (2026-10-19), apart from `api.ts` so the dashboard's chunk
 * takes only these few lines.
 */

/** Every ratings query (summary and list) starts with `['tickets', 'ratings']`. */
export const ticketRatingsPrefix = ['tickets', 'ratings'] as const;

/** The ratings view's filter (admins). */
export type RatingFilter = {
  days: TicketRatingDays;
  groupId?: string;
  value?: TicketRatingValue;
};

function ratingSearch(filter: RatingFilter, cursor?: string): string {
  const qs = new URLSearchParams({ days: String(filter.days) });
  if (filter.groupId) qs.set('groupId', filter.groupId);
  if (filter.value) qs.set('value', filter.value);
  if (cursor) qs.set('cursor', cursor);
  return `?${qs.toString()}`;
}

/** The totals of a period, for admins (the dashboard line and the ratings view). */
export const ratingSummaryQuery = (filter: { days: TicketRatingDays; groupId?: string }) =>
  queryOptions({
    queryKey: [...ticketRatingsPrefix, 'summary', filter.days, filter.groupId ?? null],
    queryFn: () =>
      apiGet(
        `/tickets/ratings/summary${ratingSearch({ days: filter.days, groupId: filter.groupId })}`,
        TicketRatingSummarySchema,
      ),
    staleTime: 5 * 60_000,
  });

/** The ratings, newest first, 50 per page (admins). */
export const ratingsListQuery = (filter: RatingFilter) =>
  infiniteQueryOptions({
    queryKey: [...ticketRatingsPrefix, 'list', filter],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      apiGet(`/tickets/ratings${ratingSearch(filter, pageParam)}`, TicketRatingListSchema),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
