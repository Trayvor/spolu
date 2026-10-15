import { queryOptions } from '@tanstack/react-query';
import {
  AiStatusSchema,
  TaskProposalsSchema,
  TasksFromMessageResultSchema,
  type TaskDetailDto,
  type TaskProposals,
  type TasksFromMessage,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

/** Which AI features the server runs; it only changes with a server restart. */
export const aiStatusQuery = queryOptions({
  queryKey: ['ai', 'status'],
  queryFn: () => apiGet('/ai/status', AiStatusSchema),
  staleTime: Infinity,
});

/** Asks the AI to split a message into task cards (422 `ai_no_tasks`, 502 `ai_failed`, 503 `ai_unavailable`). */
export function proposeTasks(messageId: string): Promise<TaskProposals> {
  return apiSend('POST', `/messages/${enc(messageId)}/task-split`, undefined, TaskProposalsSchema);
}

/** Creates the approved cards at the top of To do, in order, all or none. */
export async function createTasksFromMessage(
  groupId: string,
  input: TasksFromMessage,
): Promise<TaskDetailDto[]> {
  const result = await apiSend(
    'POST',
    `/groups/${enc(groupId)}/tasks/from-message`,
    input,
    TasksFromMessageResultSchema,
  );
  return result.tasks;
}
