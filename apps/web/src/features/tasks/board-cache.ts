import type { QueryClient } from '@tanstack/react-query';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import { byPosition } from './board-model';

export { byPosition, tasksByBucket } from './board-model';

/** Insert the task, or replace the cached copy (it may have moved bucket or position). */
export function upsertTask(board: BoardDto, task: TaskDto): BoardDto {
  const tasks = board.tasks.some((t) => t.id === task.id)
    ? board.tasks.map((t) => (t.id === task.id ? task : t))
    : [...board.tasks, task];
  return { ...board, tasks: tasks.sort(byPosition) };
}

export function removeTask(board: BoardDto, taskId: string): BoardDto {
  return { ...board, tasks: board.tasks.filter((t) => t.id !== taskId) };
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
