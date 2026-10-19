import { queryOptions } from '@tanstack/react-query';
import {
  CalendarFeedAnswerSchema,
  type CalendarFeedAnswer,
  type CalendarFeedInclude,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/** The signed-in person's calendar feed (ADR 0051); `{ feed: null }` before they make one. */
export const calendarFeedQuery = queryOptions({
  queryKey: ['me', 'calendar-feed'],
  queryFn: () => apiGet('/me/calendar-feed', CalendarFeedAnswerSchema),
  // A žiadateľ only gets 403: the card then shows nothing, without retrying.
  retry: false,
});

/** Creates the feed, or saves its switches. */
export function putCalendarFeed(include: CalendarFeedInclude): Promise<CalendarFeedAnswer> {
  return apiSend('PUT', '/me/calendar-feed', { include }, CalendarFeedAnswerSchema);
}

/** A new link; the old one stops working. */
export function rotateCalendarFeed(): Promise<CalendarFeedAnswer> {
  return apiSend('POST', '/me/calendar-feed/rotate', undefined, CalendarFeedAnswerSchema);
}

export async function deleteCalendarFeed(): Promise<void> {
  await apiSend('DELETE', '/me/calendar-feed');
}
