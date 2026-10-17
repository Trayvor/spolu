import type { QueryClient } from '@tanstack/react-query';
import type { BoardDonePage, BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import { byPosition } from './board-model';

export { byPosition, tasksByBucket } from './board-model';

const inDone = (board: BoardDto, task: Pick<TaskDto, 'bucketId'>) =>
  board.buckets.some((b) => b.id === task.bucketId && b.kind === 'done');

/**
 * Insert the task, or replace the cached copy (it may have moved bucket or position). The
 * Completed column is paged (`board.done`): its total follows tasks entering and leaving it, and
 * an unknown completed task below the loaded pages stays out (its page brings it). A shown task
 * stays shown wherever it moves.
 */
export function upsertTask(board: BoardDto, task: TaskDto): BoardDto {
  const before = board.tasks.find((t) => t.id === task.id);
  const isDone = inDone(board, task);
  const { next } = board.done;
  if (!before && isDone && next !== null && task.position > next) return board;
  const tasks = before
    ? board.tasks.map((t) => (t.id === task.id ? task : t))
    : [...board.tasks, task];
  const wasDone = before !== undefined && inDone(board, before);
  const total = board.done.total + (isDone && !wasDone ? 1 : 0) - (wasDone && !isDone ? 1 : 0);
  return { ...board, tasks: tasks.sort(byPosition), done: { ...board.done, total } };
}

/** "Show more" in Completed: the next page's tasks (each once) and its cursor. */
export function appendDonePage(board: BoardDto, page: BoardDonePage): BoardDto {
  const known = new Set(board.tasks.map((t) => t.id));
  const added = page.tasks.filter((t) => !known.has(t.id));
  return {
    ...board,
    tasks: [...board.tasks, ...added].sort(byPosition),
    done: { ...board.done, next: page.next },
  };
}

/** A task's upcoming reminder count; the same board when the task is absent or the count unchanged. */
export function setUpcomingReminders(board: BoardDto, taskId: string, count: number): BoardDto {
  const task = board.tasks.find((t) => t.id === taskId);
  if (!task || task.upcomingReminders === count) return board;
  return {
    ...board,
    tasks: board.tasks.map((t) => (t.id === taskId ? { ...t, upcomingReminders: count } : t)),
  };
}

export function removeTask(board: BoardDto, taskId: string): BoardDto {
  const before = board.tasks.find((t) => t.id === taskId);
  const total = board.done.total - (before && inDone(board, before) ? 1 : 0);
  return {
    ...board,
    tasks: board.tasks.filter((t) => t.id !== taskId),
    done: { ...board.done, total },
  };
}

/** Swap in the pushed bucket list; `removedBucket` tells the caller its tasks moved server-side. */
export function replaceBuckets(
  board: BoardDto,
  buckets: BucketDto[],
): { board: BoardDto; removedBucket: boolean } {
  const kept = new Set(buckets.map((b) => b.id));
  return {
    board: { ...board, buckets: [...buckets].sort(byPosition) },
    removedBucket: board.buckets.some((b) => !kept.has(b.id)),
  };
}

/** A one-line message above the board, keyed under `tasks.board.*`. */
export type BoardNotice = 'taskDeleted' | 'moveFailed' | 'error';

/**
 * The board's notice lives in the query cache next to the board, so code outside the board
 * (a failed drop, the task panel) can show it. Never fetched; null hides it.
 */
export const boardNoticeKey = (groupId: string) => ['tasks', groupId, 'notice'] as const;

export function showBoardNotice(
  queryClient: QueryClient,
  groupId: string,
  notice: BoardNotice | null,
): void {
  queryClient.setQueryData<BoardNotice | null>(boardNoticeKey(groupId), notice);
}
