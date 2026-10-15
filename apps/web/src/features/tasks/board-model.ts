import type { TFunction } from 'i18next';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';

/** Fractional-index keys sort by code unit (`<`), never by locale. */
export function byPosition(a: { position: string }, b: { position: string }): number {
  return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
}

/** The board's tasks grouped by bucket id, each list sorted by position. */
export function tasksByBucket(board: BoardDto): Map<string, TaskDto[]> {
  const map = new Map<string, TaskDto[]>(board.buckets.map((bucket) => [bucket.id, []]));
  for (const task of [...board.tasks].sort(byPosition)) map.get(task.bucketId)?.push(task);
  return map;
}

/** The name shown for a bucket: its own for custom ones, a translated one for the fixed four. */
export function bucketTitle(
  t: TFunction,
  bucket: Pick<BucketDto, 'kind' | 'name'>,
  groupName: string,
): string {
  switch (bucket.kind) {
    case 'todo':
      return t('tasks.buckets.todo');
    case 'egrant_review':
      return t('tasks.buckets.egrantReview');
    case 'client_review':
      return t('tasks.buckets.clientReview', { group: groupName });
    case 'done':
      return t('tasks.buckets.done');
    case 'custom':
      return bucket.name ?? '';
  }
}
