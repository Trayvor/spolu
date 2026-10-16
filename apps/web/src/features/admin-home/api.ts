import { queryOptions } from '@tanstack/react-query';
import {
  AssignedTasksSchema,
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
