import { describe, expect, it } from 'vitest';
import type { BucketDto, TaskDto } from '@spolu/shared';
import { computeBucketDrop, computeTaskDrop } from './drop';

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

/** To do: t1, t2, t3. eGrant review: e1, e2. Completed: empty. */
const columns = () =>
  new Map<string, TaskDto[]>([
    ['todo', [task('t1', 'todo', 'a0'), task('t2', 'todo', 'a1'), task('t3', 'todo', 'a2')]],
    ['egrant', [task('e1', 'egrant', 'a0'), task('e2', 'egrant', 'a1')]],
    ['done', []],
  ]);

describe('computeTaskDrop', () => {
  it('drop on another card in another bucket → after the card above the target', () => {
    expect(computeTaskDrop(columns(), 't1', 'e2', 'egrant')).toMatchObject({
      bucketId: 'egrant',
      afterTaskId: 'e1',
    });
  });

  it('drop on an empty column → afterTaskId null', () => {
    expect(computeTaskDrop(columns(), 't1', 'bucket:done', 'done')).toMatchObject({
      bucketId: 'done',
      afterTaskId: null,
    });
  });

  it('drop on a column with cards → after its last card', () => {
    expect(computeTaskDrop(columns(), 't1', 'bucket:egrant', 'egrant')).toMatchObject({
      afterTaskId: 'e2',
    });
  });

  it('drop at the top → afterTaskId null', () => {
    expect(computeTaskDrop(columns(), 't2', 'e1', 'egrant')).toMatchObject({
      bucketId: 'egrant',
      afterTaskId: null,
    });
    expect(computeTaskDrop(columns(), 't3', 't1', 'todo')).toMatchObject({
      bucketId: 'todo',
      afterTaskId: null,
    });
  });

  it('inside one bucket: down lands after the target, up lands before it', () => {
    expect(computeTaskDrop(columns(), 't1', 't2', 'todo')).toMatchObject({ afterTaskId: 't2' });
    expect(computeTaskDrop(columns(), 't3', 't2', 'todo')).toMatchObject({ afterTaskId: 't1' });
  });

  it('drop where it already is → null', () => {
    expect(computeTaskDrop(columns(), 't2', 't2', 'todo')).toBeNull();
    expect(computeTaskDrop(columns(), 't3', 'bucket:todo', 'todo')).toBeNull();
  });

  it('an unknown task or bucket → null', () => {
    expect(computeTaskDrop(columns(), 'nope', 'e1', 'egrant')).toBeNull();
    expect(computeTaskDrop(columns(), 't1', 'x1', 'gone')).toBeNull();
  });

  it('optimisticPosition sorts between the neighbours', () => {
    const between = computeTaskDrop(columns(), 't1', 'e2', 'egrant')!.optimisticPosition;
    expect('a0' < between && between < 'a1').toBe(true);
    const first = computeTaskDrop(columns(), 't1', 'e1', 'egrant')!.optimisticPosition;
    expect(first < 'a0').toBe(true);
    const last = computeTaskDrop(columns(), 't1', 'bucket:egrant', 'egrant')!.optimisticPosition;
    expect(last > 'a1').toBe(true);
  });
});

const bucket = (id: string, kind: BucketDto['kind'], position: string): BucketDto => ({
  id,
  groupId: 'g1',
  kind,
  name: kind === 'custom' ? id : null,
  position,
});
/** To do, mine, eGrant review, theirs, client review, Completed. */
const buckets = (): BucketDto[] => [
  bucket('done', 'done', 'a9'),
  bucket('todo', 'todo', 'a0'),
  bucket('mine', 'custom', 'a1'),
  bucket('egrant', 'egrant_review', 'a3'),
  bucket('theirs', 'custom', 'a4'),
  bucket('client', 'client_review', 'a6'),
];

describe('computeBucketDrop', () => {
  it('a custom bucket dropped after eGrant review', () => {
    expect(computeBucketDrop(buckets(), 'mine', 'egrant')).toEqual({ afterBucketId: 'egrant' });
  });

  it('moving left lands before the target', () => {
    expect(computeBucketDrop(buckets(), 'theirs', 'egrant')).toEqual({ afterBucketId: 'mine' });
  });

  it('dropped on To do → after To do', () => {
    expect(computeBucketDrop(buckets(), 'theirs', 'todo')).toEqual({ afterBucketId: 'todo' });
  });

  it('dropped on Completed → after the last bucket before Completed', () => {
    expect(computeBucketDrop(buckets(), 'mine', 'done')).toEqual({ afterBucketId: 'client' });
  });

  it('a fixed bucket as active → null', () => {
    expect(computeBucketDrop(buckets(), 'egrant', 'client')).toBeNull();
    expect(computeBucketDrop(buckets(), 'todo', 'mine')).toBeNull();
  });

  it('dropped where it already is → null', () => {
    expect(computeBucketDrop(buckets(), 'mine', 'mine')).toBeNull();
    expect(computeBucketDrop(buckets(), 'mine', 'todo')).toBeNull();
  });
});
