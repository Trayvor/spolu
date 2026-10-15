import { describe, expect, it } from 'vitest';
import type { BucketDto, TaskDto } from '@spolu/shared';
import { boardCollisions, computeBucketDrop, computeTaskDrop, resolveColumnHit } from './drop';

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

describe('resolveColumnHit', () => {
  // Cards 60 px high with an 8 px gap, from y = 106 (the list's 6 px padding above).
  const slots = [
    { id: 'c1', top: 106, height: 60 },
    { id: 'c2', top: 174, height: 60 },
    { id: 'c3', top: 242, height: 60 },
  ];

  it('another bucket: the gap between two cards lands before the lower one', () => {
    expect(resolveColumnHit('b', slots, 170, false)).toBe('c2');
  });

  it('another bucket: the padding above the first card lands first', () => {
    expect(resolveColumnHit('b', slots, 101, false)).toBe('c1');
  });

  it('another bucket: below the last card’s middle lands last', () => {
    expect(resolveColumnHit('b', slots, 290, false)).toBe('bucket:b');
    expect(resolveColumnHit('b', slots, 305, false)).toBe('bucket:b');
  });

  it('an empty column is the column', () => {
    expect(resolveColumnHit('b', [], 150, false)).toBe('bucket:b');
    expect(resolveColumnHit('b', [], 150, true)).toBe('bucket:b');
  });

  it('own bucket: the nearest card, never the column', () => {
    expect(resolveColumnHit('b', slots, 101, true)).toBe('c1');
    expect(resolveColumnHit('b', slots, 236, true)).toBe('c2');
    expect(resolveColumnHit('b', slots, 380, true)).toBe('c3');
  });
});

describe('boardCollisions', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  // To do (x 0–280): t1, t2, t3. eGrant review (x 300–580): e1, e2. Completed (x 600–880): empty.
  const lists = [
    ['todo', 0],
    ['egrant', 300],
    ['done', 600],
  ] as const;
  const cards = [
    ['t1', 'todo', 0, 106],
    ['t2', 'todo', 0, 174],
    ['t3', 'todo', 0, 242],
    ['e1', 'egrant', 300, 106],
    ['e2', 'egrant', 300, 174],
  ] as const;
  const containers = [
    ...lists.map(([bucketId, left]) => ({
      id: `bucket:${bucketId}`,
      data: { current: { type: 'column', bucketId } },
      rect: rect(left, 100, 280, 300),
    })),
    ...cards.map(([id, bucketId, left, top]) => ({
      id,
      data: { current: { type: 'task', title: id, bucketId } },
      rect: rect(left + 6, top, 268, 60),
    })),
  ];
  const t1 = containers.find((c) => c.id === 't1')!;

  function over(pointer: { x: number; y: number } | null, collisionTop = 106) {
    const result = boardCollisions({
      active: { id: 't1', data: t1.data },
      collisionRect: rect(6, collisionTop, 268, 60),
      droppableRects: new Map(containers.map((c) => [c.id, c.rect])),
      droppableContainers: containers,
      pointerCoordinates: pointer,
    } as never);
    return result[0]?.id;
  }

  it('a card under the pointer beats its column', () => {
    expect(over({ x: 400, y: 190 })).toBe('e2');
  });

  it('below the middle of the last card in another bucket is the end of that bucket', () => {
    expect(over({ x: 400, y: 220 })).toBe('bucket:egrant');
    // The last card of the dragged card's own bucket stays a card (the list swaps with it).
    expect(over({ x: 100, y: 275 })).toBe('t3');
  });

  it('the gap between cards in another bucket is the lower card', () => {
    expect(over({ x: 400, y: 170 })).toBe('e2');
  });

  it('the padding of another bucket: above the first card, below the last', () => {
    expect(over({ x: 400, y: 102 })).toBe('e1');
    expect(over({ x: 400, y: 380 })).toBe('bucket:egrant');
  });

  it('an empty column is the column', () => {
    expect(over({ x: 700, y: 200 })).toBe('bucket:done');
  });

  it('empty space in the own bucket is the nearest card', () => {
    expect(over({ x: 100, y: 237 })).toBe('t2');
    expect(over({ x: 100, y: 380 })).toBe('t3');
  });

  it('keyboard: the list above the first card keeps the card first', () => {
    // ArrowUp from t1 moves the rectangle to the list's top edge; no pointer.
    expect(over(null, 100)).toBe('t1');
  });
});
