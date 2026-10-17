import { act, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardDto, BucketDto, TaskDto } from '@spolu/shared';
import { GroupRoomProvider } from '@/features/groups/use-group-room';
import { boardQuery, taskQuery } from './api';
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
  upcomingReminders: 0,
  link: null,
  sourceMessageId: null,
  createdAt: '2026-10-15T10:00:00.000Z',
  updatedAt: '2026-10-15T10:00:00.000Z',
});
const initial: BoardDto = {
  buckets: [bucket('b1'), bucket('b2')],
  tasks: [task('t1')],
  done: { total: 0, next: null },
};

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

  it('refetches the board when a task arrives for an unknown bucket', async () => {
    render(tree(1));
    await waitFor(() => expect(cached()).toBeDefined());
    act(() => fake.fire('board:task', { task: task('t2'), actor: { id: 'u2', name: 'Bo' } }));
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    act(() =>
      fake.fire('board:task', {
        task: { ...task('t3'), bucketId: 'bX' },
        actor: { id: 'u2', name: 'Bo' },
      }),
    );
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(2));
  });

  it("reminders:task updates the card's count; another group's event is ignored", async () => {
    render(tree(1));
    await waitFor(() => expect(cached()).toBeDefined());
    act(() => fake.fire('reminders:task', { groupId: 'g2', taskId: 't1', upcomingReminders: 4 }));
    expect(cached().tasks[0]!.upcomingReminders).toBe(0);
    act(() => fake.fire('reminders:task', { groupId: 'g1', taskId: 't1', upcomingReminders: 2 }));
    expect(cached().tasks[0]!.upcomingReminders).toBe(2);
  });

  it('removes its listeners on unmount', async () => {
    const view = render(tree(1));
    await waitFor(() => expect(cached()).toBeDefined());
    view.unmount();
    act(() => fake.fire('board:task', { task: task('t2'), actor: { id: 'u2', name: 'Bo' } }));
    expect(cached().tasks.map((t) => t.id)).toEqual(['t1']);
  });

  it('refetches the board when the room is rejoined', async () => {
    const view = render(tree(1));
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(1));
    view.rerender(tree(1));
    expect(fetchBoard).toHaveBeenCalledTimes(1);
    view.rerender(tree(2));
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(2));
  });

  it('does not refetch on the first join of a cold load', async () => {
    // The join ack arrives after the board loaded, or while it loads.
    for (const ackFirst of [false, true]) {
      fetchBoard.mockClear();
      client.clear();
      const view = render(tree(0));
      if (ackFirst) view.rerender(tree(1));
      await waitFor(() => expect(cached()).toBeDefined());
      view.rerender(tree(1));
      await new Promise((r) => setTimeout(r, 20));
      expect(fetchBoard).toHaveBeenCalledTimes(1);
      view.rerender(tree(2)); // a real rejoin
      await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(2));
      view.unmount();
    }
  });

  it('refetches on the first join a board cached before the mount', async () => {
    client.setQueryData(boardQuery('g1').queryKey, initial, { updatedAt: Date.now() - 10_000 });
    const view = render(tree(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchBoard).not.toHaveBeenCalled(); // still fresh (staleTime)
    view.rerender(tree(1));
    await waitFor(() => expect(fetchBoard).toHaveBeenCalledTimes(1));
  });

  it('on the first join invalidates only task details cached before the mount', async () => {
    const detail = (id: string) => ({
      ...task(id),
      description: '',
      files: [],
      sourceMessage: null,
      sourceTicket: null,
      sourceMeeting: null,
    });
    const old = taskQuery('t1').queryKey;
    client.setQueryData(old, detail('t1'), { updatedAt: Date.now() - 10_000 });
    const view = render(tree(0));
    await waitFor(() => expect(cached()).toBeDefined());
    const fresh = taskQuery('t2').queryKey;
    client.setQueryData(fresh, detail('t2'));
    view.rerender(tree(1));
    await waitFor(() => expect(client.getQueryState(old)!.isInvalidated).toBe(true));
    expect(client.getQueryState(fresh)!.isInvalidated).toBe(false);
    expect(fetchBoard).toHaveBeenCalledTimes(1);
  });

  it('invalidates a cached task detail when a newer board:task arrives', async () => {
    render(tree(1));
    await waitFor(() => expect(cached()).toBeDefined());
    const key = taskQuery('t1').queryKey;
    client.setQueryData(key, {
      ...task('t1'),
      description: '',
      files: [],
      sourceMessage: null,
      sourceTicket: null,
      sourceMeeting: null,
    });
    act(() => fake.fire('board:task', { task: task('t1'), actor: { id: 'u2', name: 'Bo' } }));
    expect(client.getQueryState(key)!.isInvalidated).toBe(false);
    act(() =>
      fake.fire('board:task', {
        task: { ...task('t1'), updatedAt: '2026-10-16T10:00:00.000Z' },
        actor: { id: 'u2', name: 'Bo' },
      }),
    );
    expect(client.getQueryState(key)!.isInvalidated).toBe(true);
  });

  it('invalidates cached task details when the room is rejoined', async () => {
    const view = render(tree(1));
    await waitFor(() => expect(cached()).toBeDefined());
    const key = taskQuery('t1').queryKey;
    client.setQueryData(key, {
      ...task('t1'),
      description: '',
      files: [],
      sourceMessage: null,
      sourceTicket: null,
      sourceMeeting: null,
    });
    view.rerender(tree(2));
    await waitFor(() => expect(client.getQueryState(key)!.isInvalidated).toBe(true));
  });
});
