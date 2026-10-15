import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import { GroupRoomProvider } from '@/features/groups/use-group-room';
import { boardQuery } from './api';
import { useBoardEvents } from './use-board-events';

const fake = vi.hoisted(() => {
  const listeners = new Map<string, Set<(p: unknown) => void>>();
  return {
    on: (e: string, fn: (p: unknown) => void) => {
      if (!listeners.has(e)) listeners.set(e, new Set());
      listeners.get(e)!.add(fn);
    },
    off: (e: string, fn: (p: unknown) => void) => void listeners.get(e)?.delete(fn),
    fire: (e: string, p: unknown) => listeners.get(e)?.forEach((fn) => fn(p)),
    reset: () => listeners.clear(),
  };
});
vi.mock('@/lib/socket', () => ({ getSocket: () => fake }));

const bucket = (id: string): BucketDto => ({
  id,
  groupId: 'g1',
  kind: 'custom',
  name: id,
  position: id,
});
const task = (id: string, groupId = 'g1'): TaskDto => ({
  id,
  groupId,
  bucketId: 'b1',
  position: id,
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
const initial: BoardDto = { buckets: [bucket('b1'), bucket('b2')], tasks: [task('t1')] };

let fetchBoard: ReturnType<typeof vi.fn>;
let client: QueryClient;

function Probe() {
  useBoardEvents('g1');
  useQuery(boardQuery('g1'));
  return null;
}
function tree(joins: number) {
  return (
    <QueryClientProvider client={client}>
      <GroupRoomProvider joins={joins}>
        <Probe />
      </GroupRoomProvider>
    </QueryClientProvider>
  );
}
const cached = () => client.getQueryData<BoardDto>(boardQuery('g1').queryKey)!;

beforeEach(() => {
  fake.reset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 60_000 } } });
  fetchBoard = vi.fn(async () => new Response(JSON.stringify(initial)));
  vi.stubGlobal('fetch', fetchBoard);
});

describe('useBoardEvents', () => {
  it('applies board:task to the cache and ignores another group', async () => {
    render(tree(1));
    await waitFor(() => expect(cached()).toBeDefined());
    act(() => fake.fire('board:task', { task: task('t2'), actor: { id: 'u2', name: 'Bo' } }));
    expect(cached().tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    act(() => fake.fire('board:task', { task: task('t9', 'g2'), actor: { id: 'u2', name: 'Bo' } }));
    act(() => fake.fire('board:task_deleted', { groupId: 'g2', taskId: 't1' }));
    expect(cached().tasks.map((t) => t.id)).toEqual(['t1', 't2']);
    act(() => fake.fire('board:task_deleted', { groupId: 'g1', taskId: 't1' }));
    expect(cached().tasks.map((t) => t.id)).toEqual(['t2']);
  });

  it('board:buckets replaces buckets and refetches only when one was dropped', async () => {
    render(tree(1));
    await waitFor(() => expect(cached()).toBeDefined());
    act(() => fake.fire('board:buckets', { groupId: 'g1', buckets: [bucket('b2'), bucket('b1')] }));
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    act(() => fake.fire('board:buckets', { groupId: 'g1', buckets: [bucket('b1')] }));
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(2));
  });

  it('refetches the board when the room is rejoined', async () => {
    const view = render(tree(1));
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(1));
    view.rerender(tree(1));
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    view.rerender(tree(2));
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(2));
  });
});
