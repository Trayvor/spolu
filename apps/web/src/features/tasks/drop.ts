import type { QueryClient } from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import type { BoardDto, BucketDto, BucketPatch, TaskDto, TaskMove } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { boardQuery, moveTask, updateBucket } from './api';
import { byPosition, removeTask, showBoardNotice, upsertTask } from './board-cache';

/**
 * What a drop means for the server and for the cache. The server computes the real position
 * from `afterTaskId`; `optimisticPosition` only places the card until it answers.
 */
export type TaskDrop = { bucketId: string; afterTaskId: string | null; optimisticPosition: string };

/** Droppable id of a column (a drop on the column itself, not on one of its cards). */
export const columnDropId = (bucketId: string) => `bucket:${bucketId}`;

function arrayMove<T>(list: T[], from: number, to: number): T[] {
  const copy = [...list];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item!);
  return copy;
}

/**
 * Where a task lands when dropped on `overId` (a card, or `bucket:<id>` for a column) in
 * `overBucketId`. Inside one bucket the cards swap like a sortable list (down: after the target,
 * up: before it); in another bucket the task takes the target card's slot; on a column it goes
 * last. Null when nothing changes.
 */
export function computeTaskDrop(
  columns: Map<string, TaskDto[]>,
  activeId: string,
  overId: string,
  overBucketId: string,
): TaskDrop | null {
  const target = columns.get(overBucketId);
  const active = [...columns.values()].flat().find((t) => t.id === activeId);
  if (!target || !active) return null;
  const sameBucket = active.bucketId === overBucketId;

  let list: TaskDto[];
  if (overId === columnDropId(overBucketId)) {
    list = [...target.filter((t) => t.id !== activeId), active];
  } else {
    const overIndex = target.findIndex((t) => t.id === overId);
    if (overIndex < 0) return null;
    list = sameBucket
      ? arrayMove(target, target.indexOf(active), overIndex)
      : target.toSpliced(overIndex, 0, active);
  }

  const index = list.indexOf(active);
  const after = list[index - 1] ?? null;
  if (sameBucket && after?.id === target[target.indexOf(active) - 1]?.id) return null;
  const next = list[index + 1] ?? null;
  return {
    bucketId: overBucketId,
    afterTaskId: after?.id ?? null,
    optimisticPosition: generateKeyBetween(after?.position ?? null, next?.position ?? null),
  };
}

/**
 * Where a custom bucket lands when dropped on bucket `overId`, as the bucket it follows. It
 * moves like a sortable list, but always stays after To do and before Completed. Null for a
 * fixed bucket or when nothing changes.
 */
export function computeBucketDrop(
  buckets: BucketDto[],
  activeId: string,
  overId: string,
): { afterBucketId: string } | null {
  const sorted = [...buckets].sort(byPosition);
  const from = sorted.findIndex((b) => b.id === activeId);
  const to = sorted.findIndex((b) => b.id === overId);
  if (from < 0 || to < 0 || sorted[from]!.kind !== 'custom') return null;

  const others = sorted.filter((b) => b.id !== activeId);
  let after: BucketDto | undefined;
  if (sorted[to]!.kind === 'todo') after = sorted[to];
  else if (sorted[to]!.kind === 'done') after = others.findLast((b) => b.kind !== 'done');
  else {
    const list = arrayMove(sorted, from, to);
    after = list[list.indexOf(sorted[from]!) - 1];
  }
  if (!after || after.id === sorted[from - 1]?.id) return null;
  return { afterBucketId: after.id };
}

/**
 * Applies a task drop: the card moves in the cache at once, then the server places it. On 404
 * the task is gone ("This task was deleted."); on any other failure the card goes back to where
 * it was ("The task could not be moved."). Only this task is restored, so live events that
 * arrived meanwhile for other cards are kept.
 */
export async function handleTaskDrop(
  queryClient: QueryClient,
  groupId: string,
  taskId: string,
  drop: TaskDrop,
  move: (id: string, body: TaskMove) => Promise<TaskDto> = moveTask,
): Promise<void> {
  const key = boardQuery(groupId).queryKey;
  const before = queryClient.getQueryData<BoardDto>(key)?.tasks.find((t) => t.id === taskId);
  if (!before) return;
  const update = (apply: (board: BoardDto) => BoardDto) =>
    queryClient.setQueryData<BoardDto>(key, (board) => board && apply(board));

  // A refetch in flight would overwrite the optimistic card with the old position.
  await queryClient.cancelQueries({ queryKey: key, exact: true });
  update((board) =>
    upsertTask(board, { ...before, bucketId: drop.bucketId, position: drop.optimisticPosition }),
  );
  try {
    const task = await move(taskId, { bucketId: drop.bucketId, afterTaskId: drop.afterTaskId });
    update((board) => upsertTask(board, task));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      update((board) => removeTask(board, taskId));
      showBoardNotice(queryClient, groupId, 'taskDeleted');
    } else {
      update((board) => upsertTask(board, before));
      showBoardNotice(queryClient, groupId, 'moveFailed');
    }
  }
}

/**
 * Applies a bucket drop: the column moves in the cache at once, then the server places it. A
 * failure puts it back ("Could not save. Try again."); a 404 reloads the board (it was deleted).
 */
export async function handleBucketDrop(
  queryClient: QueryClient,
  groupId: string,
  bucketId: string,
  afterBucketId: string,
  update: (id: string, patch: BucketPatch) => Promise<BucketDto> = updateBucket,
): Promise<void> {
  const key = boardQuery(groupId).queryKey;
  const board = queryClient.getQueryData<BoardDto>(key);
  const before = board?.buckets.find((b) => b.id === bucketId);
  const after = board?.buckets.find((b) => b.id === afterBucketId);
  if (!board || !before || !after) return;
  const next = board.buckets
    .filter((b) => b.id !== bucketId && b.position > after.position)
    .sort(byPosition)[0];
  const replace = (bucket: BucketDto) =>
    queryClient.setQueryData<BoardDto>(
      key,
      (current) =>
        current && {
          ...current,
          buckets: current.buckets.map((b) => (b.id === bucket.id ? bucket : b)).sort(byPosition),
        },
    );

  await queryClient.cancelQueries({ queryKey: key, exact: true });
  replace({ ...before, position: generateKeyBetween(after.position, next?.position ?? null) });
  try {
    replace(await update(bucketId, { afterBucketId }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await queryClient.invalidateQueries({ queryKey: key, exact: true });
    } else {
      replace(before);
      showBoardNotice(queryClient, groupId, 'error');
    }
  }
}
