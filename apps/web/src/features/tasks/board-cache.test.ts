import { describe, expect, it } from 'vitest';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import { byPosition, removeTask, replaceBuckets, tasksByBucket, upsertTask } from './board-cache';

const bucket = (id: string, position: string): BucketDto => ({
  id,
  groupId: 'g1',
  kind: 'custom',
  name: id,
  position,
});
const task = (id: string, bucketId: string, position: string): TaskDto => ({
  id,
  groupId: 'g1',
  bucketId,
  position,
  title: id,
  urgent: false,
  dueDate: null,
  completedAt: null,
  createdBy: { id: 'u1', name: 'Ann' },
  assignees: [],
  fileCount: 0,
  sourceMessageId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
});
const board = (): BoardDto => ({
  buckets: [bucket('b1', 'a0'), bucket('b2', 'a1')],
  tasks: [task('t1', 'b1', 'a0'), task('t2', 'b1', 'a2')],
});
const ids = (b: BoardDto, bucketId: string) =>
  (tasksByBucket(b).get(bucketId) ?? []).map((t) => t.id);

describe('board cache', () => {
  it('byPosition compares code units', () => {
    const sorted = [{ position: 'a0l' }, { position: 'a0V' }].sort(byPosition);
    expect(sorted.map((p) => p.position)).toEqual(['a0V', 'a0l']);
  });

  it('upsertTask inserts a new task and re-sorts the bucket', () => {
    const next = upsertTask(board(), task('t3', 'b1', 'a1'));
    expect(ids(next, 'b1')).toEqual(['t1', 't3', 't2']);
  });

  it('upsertTask moves a task to another bucket', () => {
    const next = upsertTask(board(), task('t1', 'b2', 'a0'));
    expect(ids(next, 'b1')).toEqual(['t2']);
    expect(ids(next, 'b2')).toEqual(['t1']);
    expect(next.tasks).toHaveLength(2);
  });

  it('removeTask drops the task', () => {
    expect(removeTask(board(), 't1').tasks.map((t) => t.id)).toEqual(['t2']);
  });

  it('replaceBuckets reports a removed bucket', () => {
    const kept = replaceBuckets(board(), [bucket('b2', 'a1'), bucket('b1', 'a0')]);
    expect(kept.removedBucket).toBe(false);
    expect(kept.board.buckets.map((b) => b.id)).toEqual(['b1', 'b2']);
    const dropped = replaceBuckets(board(), [bucket('b1', 'a0')]);
    expect(dropped.removedBucket).toBe(true);
  });
});
