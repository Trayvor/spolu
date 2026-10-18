import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import {
  NotificationCentreStateSchema,
  NotificationGroupsPageSchema,
  NotificationPageSchema,
  type NotificationCentreState,
  type SnoozeLength,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/**
 * The notification centre (UX review F2) and the client table of `/settings/notifications`
 * (X7). The bell's state is cheap (two index reads), so it refreshes every minute while the app
 * is in view and whenever the window gets focus.
 */
export const centreStateQuery = queryOptions({
  queryKey: ['notifications', 'centre', 'state'],
  queryFn: () => apiGet('/me/notifications/state', NotificationCentreStateSchema),
  refetchInterval: 60_000,
});

export const centreListQuery = infiniteQueryOptions({
  queryKey: ['notifications', 'centre', 'list'],
  initialPageParam: undefined as string | undefined,
  queryFn: ({ pageParam }) =>
    apiGet(
      `/me/notifications${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`,
      NotificationPageSchema,
    ),
  getNextPageParam: (page) => page.nextCursor ?? undefined,
});

export async function markAllRead(): Promise<void> {
  await apiSend('POST', '/me/notifications/read', {});
}

export function setSnooze(length: SnoozeLength | null): Promise<NotificationCentreState> {
  return apiSend('PUT', '/me/notifications/snooze', { for: length }, NotificationCentreStateSchema);
}

export const notificationGroupsQuery = (q: string) =>
  infiniteQueryOptions({
    queryKey: ['notifications', 'groups', q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (pageParam) params.set('cursor', pageParam);
      const search = params.toString();
      return apiGet(
        `/me/notification-groups${search ? `?${search}` : ''}`,
        NotificationGroupsPageSchema,
      );
    },
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });

export async function setTicketWatch(groupId: string, watching: boolean): Promise<void> {
  await apiSend('PUT', `/groups/${encodeURIComponent(groupId)}/ticket-watch`, { watching });
}
