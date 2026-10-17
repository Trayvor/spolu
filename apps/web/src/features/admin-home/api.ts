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

export const ticketsQuery = queryOptions({
  queryKey: homeKeys.tickets,
  queryFn: () => apiGet('/me/home/tickets', HomeTicketsSchema),
  refetchOnWindowFocus: true,
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
});

export const assignedQuery = queryOptions({
  queryKey: homeKeys.tasks,
  queryFn: () => apiGet('/me/home/tasks', AssignedTasksSchema),
  refetchOnWindowFocus: true,
});

export const mentionsQuery = queryOptions({
  queryKey: homeKeys.mentions,
  queryFn: () => apiGet('/me/home/mentions', MentionsSchema),
  refetchOnWindowFocus: true,
});

export const remindersQuery = queryOptions({
  queryKey: homeKeys.reminders,
  queryFn: () => apiGet('/me/home/reminders', HomeRemindersSchema),
  refetchOnWindowFocus: true,
});

/** The Meetings card (Phase 30): the next 7 days, and past meetings without a summary. */
export const meetingsQuery = queryOptions({
  queryKey: homeKeys.meetings,
  queryFn: () => apiGet('/me/home/meetings', HomeMeetingsSchema),
  refetchOnWindowFocus: true,
});
