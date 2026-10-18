import { queryOptions } from '@tanstack/react-query';
import {
  BOARD_DONE_MAX,
  BOARD_DONE_PAGE,
  BoardDonePageSchema,
  AskTimeSchema,
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
import { activeBoardFilter, boardFilterParams } from './board-filter';
import { askForTime } from './time-queue';

const enc = encodeURIComponent;

// Query keys share the `['tasks']` prefix. Live events write straight into the board entry.

/**
 * How many completed tasks a refetch asks for: the ones the cached board already shows
 * ("Show more" pages), so a reload never folds the Completed column back to one page.
 */
function doneToKeep(cached: BoardDto | undefined): number {
  const doneId = cached?.buckets.find((b) => b.kind === 'done')?.id;
  const loaded = cached?.tasks.filter((t) => t.bucketId === doneId).length ?? 0;
  const pages = Math.ceil(loaded / BOARD_DONE_PAGE);
  return Math.min(Math.max(pages, 1) * BOARD_DONE_PAGE, BOARD_DONE_MAX);
}

/**
 * The group's board as it shows now: with the board's Project and Event filter (Phase 33 part
 * P2, `activeBoardFilter`) the key gets the filter, so every reader and writer of the board
 * cache (panels, drops, live events) uses the entry on screen. Unfiltered keeps the plain key.
 */
export const boardQuery = (groupId: string) => {
  const filter = activeBoardFilter(groupId);
  const filtered = filter.project !== undefined;
  return queryOptions({
    queryKey: filtered
      ? ['tasks', groupId, 'board', { project: filter.project, event: filter.event }]
      : ['tasks', groupId, 'board'],
    queryFn: ({ client, queryKey }) => {
      const params = boardFilterParams(filter);
      const done = doneToKeep(client.getQueryData<BoardDto>(queryKey));
      if (done > BOARD_DONE_PAGE) params.set('done', String(done));
      const query = params.toString() ? `?${params}` : '';
      return apiGet(`/groups/${enc(groupId)}/board${query}`, BoardDtoSchema);
    },
  });
};

/** "Show more" in the Completed column: the next page after the `after` cursor. */
export function fetchDonePage(groupId: string, after: string): Promise<BoardDonePage> {
  const params = boardFilterParams(activeBoardFilter(groupId));
  params.set('after', after);
  return apiGet(`/groups/${enc(groupId)}/board/done?${params}`, BoardDonePageSchema);
}

export const taskQuery = (taskId: string) =>
  queryOptions({
    queryKey: ['tasks', 'task', taskId],
    queryFn: () => apiGet(`/tasks/${enc(taskId)}`, TaskDetailDtoSchema),
  });

/**
 * Time on done (Phase 32): a write that completed the task for an admin assignee answers
 * `askTime`, which queues the time dialog (whatever screen made the write: the board, a drag,
 * the done circle, the panel, the global board). The answer is returned without it.
 */
function withAskTime<T extends { id: string; groupId: string; title: string }>(
  answer: T & { askTime?: boolean },
): T {
  const { askTime, ...task } = answer;
  if (askTime) askForTime({ kind: 'task', id: task.id, groupId: task.groupId, title: task.title });
  return task as unknown as T;
}

const WithAskTime = AskTimeSchema.partial();

export async function createTask(
  groupId: string,
  input: TaskDraft & { bucketId?: string },
): Promise<TaskDetailDto> {
  return withAskTime(
    await apiSend(
      'POST',
      `/groups/${enc(groupId)}/tasks`,
      input,
      TaskDetailDtoSchema.extend(WithAskTime.shape),
    ),
  );
}

export async function updateTask(id: string, patch: TaskPatch): Promise<TaskDetailDto> {
  return withAskTime(
    await apiSend(
      'PATCH',
      `/tasks/${enc(id)}`,
      patch,
      TaskDetailDtoSchema.extend(WithAskTime.shape),
    ),
  );
}

export async function moveTask(id: string, body: TaskMove): Promise<TaskDto> {
  return withAskTime(
    await apiSend('POST', `/tasks/${enc(id)}/move`, body, TaskDtoSchema.extend(WithAskTime.shape)),
  );
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
