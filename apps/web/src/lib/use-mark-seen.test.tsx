import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { BoardEvents, ChatEvents, TicketEvents } from '@spolu/shared';
import { MARK_SEEN_DELAY_MS, useMarkSeen, type SeenTarget } from './use-mark-seen';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const socket = {
  on: vi.fn((event: string, fn: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  }),
  off: vi.fn((event: string, fn: Handler) => handlers.get(event)?.delete(fn)),
};
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

const fire = (event: string, payload: unknown) =>
  act(() => handlers.get(event)?.forEach((fn) => fn(payload)));

let posts: string[] = [];

beforeEach(() => {
  handlers.clear();
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') posts.push(url);
      return new Response(null, { status: 204 });
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useMarkSeen (2026-10-17)', () => {
  it('marks the open task seen, and again shortly after a live change of it', async () => {
    vi.useFakeTimers();
    renderHook(() => useMarkSeen({ kind: 'task', id: 't1' }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(posts).toEqual(['/api/tasks/t1/seen']);
    fire(BoardEvents.task, { task: { id: 't2' } });
    fire(ChatEvents.message, { taskId: 't2', channelId: 'c', isNew: true });
    await act(() => vi.advanceTimersByTimeAsync(MARK_SEEN_DELAY_MS));
    expect(posts).toHaveLength(1);
    fire(ChatEvents.message, { taskId: 't1', channelId: 'c', isNew: true });
    fire(BoardEvents.task, { task: { id: 't1' } });
    await act(() => vi.advanceTimersByTimeAsync(MARK_SEEN_DELAY_MS));
    expect(posts).toEqual(['/api/tasks/t1/seen', '/api/tasks/t1/seen']);
  });

  it('a live change does not mark it seen while the first mark is held back (2026-10-18)', async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ ready }) => useMarkSeen({ kind: 'task', id: 't1' }, ready), {
      initialProps: { ready: false },
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    fire(BoardEvents.task, { task: { id: 't1' } });
    await act(() => vi.advanceTimersByTimeAsync(MARK_SEEN_DELAY_MS));
    expect(posts).toEqual([]);
    rerender({ ready: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(posts).toEqual(['/api/tasks/t1/seen']);
  });

  it('a ticket: its own events and its chat count, nothing before it loads', async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook((target: SeenTarget | null) => useMarkSeen(target), {
      initialProps: null as SeenTarget | null,
    });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(posts).toEqual([]);
    rerender({ kind: 'ticket', id: 'k1', channelId: 'c9' });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(posts).toEqual(['/api/tickets/k1/seen']);
    fire(TicketEvents.updated, { ticketId: 'k1', groupId: 'g1' });
    await act(() => vi.advanceTimersByTimeAsync(MARK_SEEN_DELAY_MS));
    fire(ChatEvents.message, { taskId: null, channelId: 'c9', isNew: true });
    await act(() => vi.advanceTimersByTimeAsync(MARK_SEEN_DELAY_MS));
    expect(posts).toHaveLength(3);
  });
});
