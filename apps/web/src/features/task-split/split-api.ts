import {
  TaskProposalsSchema,
  TasksFromMessageResultSchema,
  type TaskDetailDto,
  type TaskProposals,
  type TasksFromMessage,
  type TasksFromMeeting,
  type TasksFromText,
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

/** A meeting's action items as cards (Phase 30; no AI call, the summary has them). */
export function proposeMeetingTasks(itemId: string): Promise<TaskProposals> {
  return apiSend(
    'POST',
    `/knowledge/${enc(itemId)}/meeting/task-proposals`,
    undefined,
    TaskProposalsSchema,
  );
}

/** Creates a meeting's approved cards at the top of the chosen bucket (absent: To do). */
export async function createTasksFromMeeting(
  itemId: string,
  input: TasksFromMeeting,
): Promise<TaskDetailDto[]> {
  const result = await apiSend(
    'POST',
    `/knowledge/${enc(itemId)}/meeting/tasks`,
    input,
    TasksFromMessageResultSchema,
  );
  return result.tasks;
}

/** Asks the AI to split a pasted text into task cards for the board of `groupId`. */
export function proposeTextTasks(groupId: string, text: string): Promise<TaskProposals> {
  return apiSend('POST', `/groups/${enc(groupId)}/task-split-text`, { text }, TaskProposalsSchema);
}

/** Creates a text's approved cards at the top of the chosen bucket (absent: To do). */
export async function createTasksFromText(
  groupId: string,
  input: TasksFromText,
): Promise<TaskDetailDto[]> {
  const result = await apiSend(
    'POST',
    `/groups/${enc(groupId)}/tasks/from-text`,
    input,
    TasksFromMessageResultSchema,
  );
  return result.tasks;
}
