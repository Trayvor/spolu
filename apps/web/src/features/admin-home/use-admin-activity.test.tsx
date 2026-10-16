import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminEvents, ChatEvents } from '@spolu/shared';
import { homeKeys } from './api';
import { useAdminActivityRefetch } from './use-admin-activity';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const socket = {
  connected: true,
  on: vi.fn((event: string, fn: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  }),
  off: vi.fn((event: string, fn: Handler) => handlers.get(event)?.delete(fn)),
  emit: vi.fn(),
};
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));
const fire = (event: string, payload: unknown = {}) =>
  act(() => handlers.get(event)?.forEach((fn) => fn(payload)));

function Probe({
  keys,
  options,
}: {
  keys: readonly (readonly string[])[];
  options?: Parameters<typeof useAdminActivityRefetch>[1];
}) {
  useAdminActivityRefetch(keys, options);
  return null;
}

let visibility: DocumentVisibilityState = 'visible';

function setup(
  keys: readonly (readonly string[])[],
  options?: Parameters<typeof useAdminActivityRefetch>[1],
) {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <Probe keys={keys} options={options} />
    </QueryClientProvider>,
  );
  const refetched = () =>
    invalidate.mock.calls.filter(([filters]) => filters?.refetchType !== 'none');
  return { invalidate, refetched };
}

describe('useAdminActivityRefetch', () => {
  beforeEach(() => {
    handlers.clear();
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('three activity events within 2 s give one invalidation', async () => {
    const { refetched } = setup([homeKeys.sidebar]);
    fire(AdminEvents.activity, { groupId: 'g1', kind: 'chat' });
    await act(() => vi.advanceTimersByTimeAsync(900));
    fire(AdminEvents.activity, { groupId: 'g2', kind: 'task' });
    await act(() => vi.advanceTimersByTimeAsync(900));
    fire(AdminEvents.activity, { groupId: 'g1', kind: 'chat' });
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(refetched()).toHaveLength(0);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(refetched().map(([f]) => f?.queryKey)).toEqual([homeKeys.sidebar]);
  });

  it('chat:read invalidates the sidebar and the mentions keys after the debounce', async () => {
    const { refetched } = setup([homeKeys.sidebar, homeKeys.mentions]);
    fire(ChatEvents.read, { groupId: 'g1', channelId: 'c1' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(refetched().map(([f]) => f?.queryKey)).toEqual([homeKeys.sidebar, homeKeys.mentions]);
  });

  it('a hidden page invalidates once when it becomes visible', async () => {
    const { refetched, invalidate } = setup([homeKeys.sidebar]);
    visibility = 'hidden';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    fire(AdminEvents.activity, { groupId: 'g1', kind: 'chat' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(refetched()).toHaveLength(0);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: homeKeys.sidebar, refetchType: 'none' });
    visibility = 'visible';
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refetched()).toHaveLength(1);
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(refetched()).toHaveLength(1);
  });

  it('kinds and chatRead filter what counts (the global board: tasks only)', async () => {
    const { refetched } = setup([['tasks', 'global']], { kinds: ['task'], chatRead: false });
    fire(AdminEvents.activity, { groupId: 'g1', kind: 'chat' });
    fire(ChatEvents.read, { groupId: 'g1', channelId: 'c1' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(refetched()).toHaveLength(0);
    fire(AdminEvents.activity, { groupId: 'g1', kind: 'task' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(refetched()).toHaveLength(1);
  });
});
