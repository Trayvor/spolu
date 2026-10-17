import { queryOptions } from '@tanstack/react-query';
import {
  BOARD_DONE_MAX,
  BOARD_DONE_PAGE,
  BoardDonePageSchema,
  BoardDtoSchema,
  BucketDtoSchema,
  TaskDetailDtoSchema,
  TaskDtoSchema,
  type BoardDonePage,
  type BoardDto,
  type BucketDto,
  type BucketPatch,
  type TaskDetailDto,
  type TaskDto,
  type TaskDraft,
  type TaskMove,
  type TaskPatch,
} from '@spolu/shared';
import { apiGet, apiSend } from '@/lib/api';

const enc = encodeURIComponent;

// Query keys share the `['tasks']` prefix. Live events write straight into the board entry.

/**
 * How many completed tasks a refetch asks for: the ones the cached board already shows
 * ("Show more" pages), so a reload never folds the Completed column back to one page.
 */
export function doneToKeep(cached: BoardDto | undefined): number {
  const doneId = cached?.buckets.find((b) => b.kind === 'done')?.id;
  const loaded = cached?.tasks.filter((t) => t.bucketId === doneId).length ?? 0;
  const pages = Math.ceil(loaded / BOARD_DONE_PAGE);
  return Math.min(Math.max(pages, 1) * BOARD_DONE_PAGE, BOARD_DONE_MAX);
}

export const boardQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['tasks', groupId, 'board'],
    queryFn: ({ client, queryKey }) => {
      const done = doneToKeep(client.getQueryData<BoardDto>(queryKey));
      const query = done > BOARD_DONE_PAGE ? `?done=${done}` : '';
      return apiGet(`/groups/${enc(groupId)}/board${query}`, BoardDtoSchema);
    },
  });

/** "Show more" in the Completed column: the next page after the `after` cursor. */
export function fetchDonePage(groupId: string, after: string): Promise<BoardDonePage> {
  return apiGet(`/groups/${enc(groupId)}/board/done?after=${enc(after)}`, BoardDonePageSchema);
}

export const taskQuery = (taskId: string) =>
  queryOptions({
    queryKey: ['tasks', 'task', taskId],
    queryFn: () => apiGet(`/tasks/${enc(taskId)}`, TaskDetailDtoSchema),
  });

export function createTask(
  groupId: string,
  input: TaskDraft & { bucketId?: string },
): Promise<TaskDetailDto> {
  return apiSend('POST', `/groups/${enc(groupId)}/tasks`, input, TaskDetailDtoSchema);
}

export function updateTask(id: string, patch: TaskPatch): Promise<TaskDetailDto> {
  return apiSend('PATCH', `/tasks/${enc(id)}`, patch, TaskDetailDtoSchema);
}

export function moveTask(id: string, body: TaskMove): Promise<TaskDto> {
  return apiSend('POST', `/tasks/${enc(id)}/move`, body, TaskDtoSchema);
}

export async function deleteTask(id: string): Promise<void> {
  await apiSend('DELETE', `/tasks/${enc(id)}`);
}

export function createBucket(groupId: string, name: string): Promise<BucketDto> {
  return apiSend('POST', `/groups/${enc(groupId)}/buckets`, { name }, BucketDtoSchema);
}

export function updateBucket(id: string, patch: BucketPatch): Promise<BucketDto> {
  return apiSend('PATCH', `/buckets/${enc(id)}`, patch, BucketDtoSchema);
}

export async function deleteBucket(id: string): Promise<void> {
  await apiSend('DELETE', `/buckets/${enc(id)}`);
}
