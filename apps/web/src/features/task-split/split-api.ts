import {
  TaskProposalsSchema,
  TasksFromMessageResultSchema,
  type TaskDetailDto,
  type TaskProposals,
  type TasksFromMessage,
  type TasksFromTicket,
} from '@spolu/shared';
import { apiSend } from '@/lib/api';

// Imported only by the lazy review dialog, so these calls and their schemas load with it.

const enc = encodeURIComponent;

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

/** Asks the AI to split a ticket into task cards (also 403 for a requester, 409 without a client). */
export function proposeTicketTasks(ticketId: string): Promise<TaskProposals> {
  return apiSend('POST', `/tickets/${enc(ticketId)}/task-split`, undefined, TaskProposalsSchema);
}

/** Creates a ticket's approved cards at the top of To do, in order, all or none. */
export async function createTasksFromTicket(
  groupId: string,
  input: TasksFromTicket,
): Promise<TaskDetailDto[]> {
  const result = await apiSend(
    'POST',
    `/groups/${enc(groupId)}/tasks/from-ticket`,
    input,
    TasksFromMessageResultSchema,
  );
  return result.tasks;
}
