import { queryOptions, type QueryClient } from '@tanstack/react-query';
import {
  TaskTimeDtoSchema,
  TicketTimeDtoSchema,
  type PutMyTicketTimeBody,
  type TaskTimeDto,
  type TicketTimeDto,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

/**
 * Time on done (Phase 32): the caller's own time on a task or a ticket, and a finance admin's
 * view of everyone's (`assignees`). Separate from the task and ticket DTOs, which never carry
 * time. Only admins call these.
 */
const enc = encodeURIComponent;

export const taskTimeQuery = (taskId: string) =>
  queryOptions({
    queryKey: ['tasks', 'time', taskId],
    queryFn: () => apiGet(`/tasks/${enc(taskId)}/time`, TaskTimeDtoSchema),
  });

export const ticketTimeQuery = (ticketId: string) =>
  queryOptions({
    queryKey: ['tickets', 'time', ticketId],
    queryFn: () => apiGet(`/tickets/${enc(ticketId)}/time`, TicketTimeDtoSchema),
  });

/** The dashboard's "Fill in your time" rows live in My tasks (`homeKeys.tasks`). */
const HOME_TASKS_KEY = ['home', 'tasks'] as const;

export async function saveMyTaskTime(
  queryClient: QueryClient,
  taskId: string,
  minutes: number,
): Promise<TaskTimeDto> {
  const saved = await apiSend(
    'PUT',
    `/tasks/${enc(taskId)}/time/me`,
    { minutes },
    TaskTimeDtoSchema,
  );
  queryClient.setQueryData(taskTimeQuery(taskId).queryKey, saved);
  void queryClient.invalidateQueries({ queryKey: HOME_TASKS_KEY });
  return saved;
}

export async function saveMyTicketTime(
  queryClient: QueryClient,
  ticketId: string,
  body: PutMyTicketTimeBody,
): Promise<TicketTimeDto> {
  const saved = await apiSend(
    'PUT',
    `/tickets/${enc(ticketId)}/time/me`,
    body,
    TicketTimeDtoSchema,
  );
  queryClient.setQueryData(ticketTimeQuery(ticketId).queryKey, saved);
  void queryClient.invalidateQueries({ queryKey: HOME_TASKS_KEY });
  return saved;
}
