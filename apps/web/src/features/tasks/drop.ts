import { closestCorners, pointerWithin, type CollisionDetection } from '@dnd-kit/core';
import type { QueryClient } from '@tanstack/react-query';
import { generateKeyBetween } from 'fractional-indexing';
import type { BoardDto, BucketDto, BucketPatch, TaskDto, TaskMove } from '@spolu/shared';
import { ApiError } from '@/lib/api';
import { boardQuery, moveTask, updateBucket } from './api';
import { byPosition, removeTask, showBoardNotice, upsertTask } from './board-cache';
import type { DragData } from './dnd-announcements';

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
 * The done circle as a drop: a task outside Completed goes to the top of Completed, a task in
 * Completed to the top of To do. The same move endpoint and events as a drag. Null when the
 * board has no such bucket.
 */
export function computeDoneToggle(
  columns: Map<string, TaskDto[]>,
  buckets: BucketDto[],
  task: TaskDto,
): TaskDrop | null {
  const current = buckets.find((b) => b.id === task.bucketId);
  const target = buckets.find((b) => b.kind === (current?.kind === 'done' ? 'todo' : 'done'));
  if (!target) return null;
  const first = columns.get(target.id)?.[0];
  return {
    bucketId: target.id,
    afterTaskId: null,
    optimisticPosition: generateKeyBetween(null, first?.position ?? null),
  };
}

/**
 * Where a bucket, fixed or custom, lands when dropped on bucket `overId`, as the bucket it follows
 * (null = first). It moves like a sortable list: right lands after the target, left before it.
 * Null when nothing changes.
 */
export function computeBucketDrop(
  buckets: BucketDto[],
  activeId: string,
  overId: string,
): { afterBucketId: string | null } | null {
  const sorted = [...buckets].sort(byPosition);
  const from = sorted.findIndex((b) => b.id === activeId);
  const to = sorted.findIndex((b) => b.id === overId);
  if (from < 0 || to < 0 || from === to) return null;
  const list = arrayMove(sorted, from, to);
  const after = list[to - 1] ?? null;
  return { afterBucketId: after?.id ?? null };
}

/** A card's vertical extent in its column. */
export type CardSlot = { id: string; top: number; height: number };

/**
 * The card a hit on a column's empty space (the gaps between cards, its padding) stands for,
 * so the board shows and sends the same place. In the dragged card's own bucket: the nearest
 * card (the sortable list swaps with it). In another bucket: the first card whose middle is
 * below `y` (the card lands before it), or the column itself (last place) below the last
 * card's middle. An empty column is the column.
 */
export function resolveColumnHit(
  bucketId: string,
  cards: CardSlot[],
  y: number,
  ownBucket: boolean,
): string {
  const middle = (card: CardSlot) => card.top + card.height / 2;
  if (ownBucket && cards.length > 0) {
    const distance = (card: CardSlot) => Math.abs(middle(card) - y);
    return cards.reduce((best, card) => (distance(card) < distance(best) ? card : best)).id;
  }
  return cards.find((card) => y < middle(card))?.id ?? columnDropId(bucketId);
}

/**
 * What the dragged item is over. Under the pointer a card beats its column; with no pointer
 * (keyboard) or between columns, the nearest target by its corners. A column hit is then turned
 * into a card with `resolveColumnHit` (the keyboard points with the moved rectangle's top edge).
 */
export const boardCollisions: CollisionDetection = (args) => {
  const dataOf = (id: string | number) =>
    args.droppableContainers.find((c) => c.id === id)?.data.current as DragData | undefined;
  const slotsOf = (bucketId: string): CardSlot[] =>
    args.droppableContainers
      .flatMap((container) => {
        const data = container.data.current as DragData | undefined;
        const rect = args.droppableRects.get(container.id);
        return data?.type === 'task' && data.bucketId === bucketId && rect
          ? [{ id: String(container.id), top: rect.top, height: rect.height }]
          : [];
      })
      .sort((a, b) => a.top - b.top);
  const active = args.active.data.current as DragData | undefined;
  const y = args.pointerCoordinates?.y ?? args.collisionRect.top;

  const hits = pointerWithin(args);
  const cards = hits.filter((hit) => dataOf(hit.id)?.type === 'task');
  const found = cards.length > 0 ? cards : hits.length > 0 ? hits : closestCorners(args);
  const target = found[0] && dataOf(found[0].id);

  if (target?.type === 'task') {
    // In another bucket, everything below the last card's middle means "last place".
    const slots = slotsOf(target.bucketId);
    const last = slots.at(-1);
    const ownBucket = active?.type === 'task' && active.bucketId === target.bucketId;
    if (!ownBucket && last && last.id === found[0]!.id && y >= last.top + last.height / 2) {
      return [{ id: columnDropId(target.bucketId) }];
    }
    return found;
  }
  if (target?.type !== 'column') return found;

  const ownBucket = active?.type === 'task' && active.bucketId === target.bucketId;
  return [{ id: resolveColumnHit(target.bucketId, slotsOf(target.bucketId), y, ownBucket) }];
};

/** Cancels a board fetch in flight (it would undo an optimistic write); true when one was. */
async function pauseBoardFetch(queryClient: QueryClient, key: readonly unknown[]) {
  const fetching = queryClient.isFetching({ queryKey: key, exact: true }) > 0;
  await queryClient.cancelQueries({ queryKey: key, exact: true });
  return fetching;
}

/**
 * Applies a task drop: the card moves in the cache at once, then the server places it.
 * - Success: the server's place wins; a newer live edit of the card keeps its content, and a
 *   card deleted live meanwhile stays deleted.
 * - 404: the task, or its target bucket, is gone. The board is reloaded and says "This task was
 *   deleted." only when the task is really missing ("The task could not be moved." otherwise).
 * - Any other failure: the card goes back, unless a live event moved it meanwhile; "The task
 *   could not be moved." Other cards are never touched, so their live changes are kept.
 * A board fetch cancelled for the optimistic write is made up for afterwards.
 */
export async function handleTaskDrop(
  queryClient: QueryClient,
  groupId: string,
  taskId: string,
  drop: TaskDrop,
  move: (id: string, body: TaskMove) => Promise<TaskDto> = moveTask,
): Promise<void> {
  const key = boardQuery(groupId).queryKey;
  const cached = () => queryClient.getQueryData<BoardDto>(key)?.tasks.find((t) => t.id === taskId);
  const before = cached();
  if (!before) return;
  const update = (apply: (board: BoardDto) => BoardDto) =>
    queryClient.setQueryData<BoardDto>(key, (board) => board && apply(board));

  let reload = await pauseBoardFetch(queryClient, key);
  const placed = { ...before, bucketId: drop.bucketId, position: drop.optimisticPosition };
  update((board) => upsertTask(board, placed));
  try {
    const task = await move(taskId, { bucketId: drop.bucketId, afterTaskId: drop.afterTaskId });
    const current = cached();
    if (current) {
      const { bucketId, position, completedAt } = task;
      // `updatedAt` only grows (a move leaves it alone), so a higher one is a newer edit.
      const next =
        current.updatedAt > task.updatedAt ? { ...current, bucketId, position, completedAt } : task;
      update((board) => upsertTask(board, next));
    }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      update((board) => removeTask(board, taskId));
      reload = false;
      await queryClient.invalidateQueries({ queryKey: key, exact: true });
      showBoardNotice(queryClient, groupId, cached() ? 'moveFailed' : 'taskDeleted');
    } else {
      const current = cached();
      if (current?.bucketId === placed.bucketId && current.position === placed.position) {
        update((board) =>
          upsertTask(board, { ...current, bucketId: before.bucketId, position: before.position }),
        );
      }
      showBoardNotice(queryClient, groupId, 'moveFailed');
    }
  }
  if (reload) void queryClient.invalidateQueries({ queryKey: key, exact: true });
}

/**
 * Applies a bucket drop (`afterBucketId` null = first): the column moves in the cache at once, then the server places it. A
 * failure puts it back unless a live event moved it meanwhile ("Could not save. Try again."); a
 * 404 reloads the board (it was deleted).
 */
export async function handleBucketDrop(
  queryClient: QueryClient,
  groupId: string,
  bucketId: string,
  afterBucketId: string | null,
  update: (id: string, patch: BucketPatch) => Promise<BucketDto> = updateBucket,
): Promise<void> {
  const key = boardQuery(groupId).queryKey;
  const board = queryClient.getQueryData<BoardDto>(key);
  const before = board?.buckets.find((b) => b.id === bucketId);
  // null = first: the column goes before every other one.
  const after = board?.buckets.find((b) => b.id === afterBucketId) ?? null;
  if (!board || !before || (afterBucketId !== null && !after)) return;
  const next = board.buckets
    .filter((b) => b.id !== bucketId && (after === null || b.position > after.position))
    .sort(byPosition)[0];
  const cached = () =>
    queryClient.getQueryData<BoardDto>(key)?.buckets.find((b) => b.id === bucketId);
  const replace = (bucket: BucketDto) =>
    queryClient.setQueryData<BoardDto>(
      key,
      (current) =>
        current && {
          ...current,
          buckets: current.buckets.map((b) => (b.id === bucket.id ? bucket : b)).sort(byPosition),
        },
    );

  let reload = await pauseBoardFetch(queryClient, key);
  const position = generateKeyBetween(after?.position ?? null, next?.position ?? null);
  replace({ ...before, position });
  try {
    replace(await update(bucketId, { afterBucketId }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      reload = true;
    } else {
      const current = cached();
      if (current?.position === position) replace({ ...current, position: before.position });
      showBoardNotice(queryClient, groupId, 'error');
    }
  }
  if (reload) await queryClient.invalidateQueries({ queryKey: key, exact: true });
}
