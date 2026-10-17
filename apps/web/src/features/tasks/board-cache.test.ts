import { describe, expect, it } from 'vitest';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import {
  appendDonePage,
  byPosition,
  removeTask,
  replaceBuckets,
  setUpcomingReminders,
  tasksByBucket,
  upsertTask,
} from './board-cache';

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
  upcomingReminders: 0,
  link: null,
  sourceMessageId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
});
const board = (): BoardDto => ({
  buckets: [bucket('b1', 'a0'), bucket('b2', 'a1')],
  tasks: [task('t1', 'b1', 'a0'), task('t2', 'b1', 'a2')],
  done: { total: 0, next: null },
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

  it('tasksByBucket sorts each bucket and skips tasks of unknown buckets', () => {
    const b = upsertTask(board(), task('t3', 'gone', 'a0'));
    expect(ids(b, 'b1')).toEqual(['t1', 't2']);
    expect(tasksByBucket(b).has('gone')).toBe(false);
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

  it('setUpcomingReminders updates one task and keeps identity when unchanged', () => {
    const b = board();
    const next = setUpcomingReminders(b, 't2', 3);
    expect(next.tasks.find((x) => x.id === 't2')!.upcomingReminders).toBe(3);
    expect(next.tasks.find((x) => x.id === 't1')).toBe(b.tasks[0]);
    expect(setUpcomingReminders(next, 't2', 3)).toBe(next);
    expect(setUpcomingReminders(b, 'missing', 1)).toBe(b);
  });
});

describe('board cache: the paged Completed column (S8)', () => {
  const doneBucket: BucketDto = { ...bucket('bd', 'a9'), kind: 'done', name: null };
  const doneTask = (id: string, position: string): TaskDto => ({
    ...task(id, 'bd', position),
    completedAt: '2026-10-15T11:00:00.000Z',
  });
  /** To do with t1; Completed shows d1 and d2 (cursor d2's position) of 5. */
  const paged = (): BoardDto => ({
    buckets: [bucket('b1', 'a0'), doneBucket],
    tasks: [task('t1', 'b1', 'a0'), doneTask('d1', 'a1'), doneTask('d2', 'a2')],
    done: { total: 5, next: 'a2' },
  });

  it('a task entering Completed counts, leaving it uncounts', () => {
    const entered = upsertTask(paged(), { ...task('t1', 'bd', 'a0'), completedAt: 'x' });
    expect(ids(entered, 'bd')).toEqual(['t1', 'd1', 'd2']);
    expect(entered.done.total).toBe(6);
    const left = upsertTask(entered, task('d1', 'b1', 'a5'));
    expect(left.done.total).toBe(5);
    // An optimistic move (bucket changed, completedAt not yet) counts the same way.
    expect(upsertTask(paged(), task('t1', 'bd', 'a0')).done.total).toBe(6);
  });

  it('an unknown completed task past the loaded pages stays out; inside them it is added', () => {
    const past = upsertTask(paged(), doneTask('d4', 'a4'));
    expect(past.tasks.some((t) => t.id === 'd4')).toBe(false);
    expect(past.done.total).toBe(5);
    const inside = upsertTask(paged(), doneTask('d0', 'a0'));
    expect(ids(inside, 'bd')).toEqual(['d0', 'd1', 'd2']);
    expect(inside.done.total).toBe(6);
    // Every page loaded (next null): any completed task belongs.
    const all = { ...paged(), done: { total: 2, next: null } };
    expect(upsertTask(all, doneTask('d9', 'a9')).done.total).toBe(3);
  });

  it('a shown task that moves within Completed stays shown, uncounted', () => {
    const moved = upsertTask(paged(), doneTask('d1', 'a8'));
    expect(ids(moved, 'bd')).toEqual(['d2', 'd1']);
    expect(moved.done.total).toBe(5);
  });

  it('removing a shown completed task uncounts it; an unknown one changes nothing', () => {
    expect(removeTask(paged(), 'd1').done.total).toBe(4);
    expect(removeTask(paged(), 't1').done.total).toBe(5);
    expect(removeTask(paged(), 'nope').done.total).toBe(5);
  });

  it('appendDonePage adds the next page once and moves the cursor', () => {
    const page = { tasks: [doneTask('d2', 'a2'), doneTask('d3', 'a3')], next: null };
    const next = appendDonePage(paged(), page);
    expect(ids(next, 'bd')).toEqual(['d1', 'd2', 'd3']);
    expect(next.done).toEqual({ total: 5, next: null });
  });
});
