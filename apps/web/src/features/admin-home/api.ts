import { queryOptions } from '@tanstack/react-query';
import {
  AssignedTasksSchema,
  HomeMeetingsSchema,
  HomeRemindersSchema,
  HomeTicketsSchema,
  MentionsSchema,
  NavCountsSchema,
  SidebarSchema,
} from '@spolu/shared';
import { apiGet } from '@/lib/api';

/** The admin home's queries (Phase 20): one request per block, each refetched on its own. */
export const homeKeys = {
  sidebar: ['home', 'sidebar'],
  tasks: ['home', 'tasks'],
  tickets: ['home', 'tickets'],
  mentions: ['home', 'mentions'],
  reminders: ['home', 'reminders'],
  meetings: ['home', 'meetings'],
  counts: ['home', 'counts'],
} as const;

/**
 * Zero: opening the dashboard always refetches. The socket listeners that keep it fresh
 * (`use-admin-activity.ts`) only exist while it is mounted, so a message read elsewhere would
 * otherwise leave up to 30 s of stale counts on return. One request per block, no polling.
 */
const HOME_STALE_MS = 0;

export const ticketsQuery = queryOptions({
  queryKey: homeKeys.tickets,
  queryFn: () => apiGet('/me/home/tickets', HomeTicketsSchema),
  refetchOnWindowFocus: true,
  staleTime: HOME_STALE_MS,
});

/** The header's Tasks and Tickets counts (admins). */
export const navCountsQuery = queryOptions({
  queryKey: homeKeys.counts,
  queryFn: () => apiGet('/me/home/counts', NavCountsSchema),
  refetchOnWindowFocus: true,
});

export const sidebarQuery = queryOptions({
  queryKey: homeKeys.sidebar,
  queryFn: () => apiGet('/me/home/sidebar', SidebarSchema),
  refetchOnWindowFocus: true,
  staleTime: HOME_STALE_MS,
});

export const assignedQuery = queryOptions({
  queryKey: homeKeys.tasks,
  queryFn: () => apiGet('/me/home/tasks', AssignedTasksSchema),
  refetchOnWindowFocus: true,
  staleTime: HOME_STALE_MS,
});

export const mentionsQuery = queryOptions({
  queryKey: homeKeys.mentions,
  queryFn: () => apiGet('/me/home/mentions', MentionsSchema),
  refetchOnWindowFocus: true,
  staleTime: HOME_STALE_MS,
});

export const remindersQuery = queryOptions({
  queryKey: homeKeys.reminders,
  queryFn: () => apiGet('/me/home/reminders', HomeRemindersSchema),
  refetchOnWindowFocus: true,
  staleTime: HOME_STALE_MS,
});

/** The Meetings card (Phase 30): the next 7 days, and past meetings without a summary. */
export const meetingsQuery = queryOptions({
  queryKey: homeKeys.meetings,
  queryFn: () => apiGet('/me/home/meetings', HomeMeetingsSchema),
  refetchOnWindowFocus: true,
  staleTime: HOME_STALE_MS,
});
