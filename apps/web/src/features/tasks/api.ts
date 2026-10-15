import { queryOptions } from '@tanstack/react-query';
import {
  BoardDtoSchema,
  BucketDtoSchema,
  TaskDetailDtoSchema,
  TaskDtoSchema,
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

export const boardQuery = (groupId: string) =>
  queryOptions({
    queryKey: ['tasks', groupId, 'board'],
    queryFn: () => apiGet(`/groups/${enc(groupId)}/board`, BoardDtoSchema),
  });

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
