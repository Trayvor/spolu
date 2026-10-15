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
