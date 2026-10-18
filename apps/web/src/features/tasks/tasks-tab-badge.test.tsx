import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BoardEvents, SeenEvents } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { TasksTabBadge } from './tasks-tab-badge';
import { BOARD_UNSEEN_DEBOUNCE_MS } from './unseen';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const socket = {
  connected: false,
  on: vi.fn((event: string, fn: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  }),
  off: vi.fn((event: string, fn: Handler) => handlers.get(event)?.delete(fn)),
  emit: vi.fn(),
};
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

const fire = (event: string, payload: unknown) => handlers.get(event)?.forEach((fn) => fn(payload));

let unseenCalls = 0;
function mockApi(taskIds: string[]) {
  unseenCalls = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const reply = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
      if (url === '/api/me') {
        return reply({
          id: 'a1',
          name: 'Ada',
          email: 'a@x.sk',
          role: 'admin',
          finance: false,
          groups: [],
        });
      }
      if (url === '/api/groups/g1/task-chats') {
        return reply({ t1: { count: 2, unread: true }, t2: { count: 1, unread: true } });
      }
      if (url === '/api/groups/g1/board/unseen') {
        unseenCalls++;
        return reply({ taskIds });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
}

const renderBadge = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <TasksTabBadge groupId="g1" />
    </QueryClientProvider>,
  );
};

describe('TasksTabBadge', () => {
  beforeEach(async () => {
    handlers.clear();
    await setLanguage('en');
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('shows one black badge: the tasks with an unseen change, not the unread chats or the assigned', async () => {
    mockApi(['t1', 't2', 't3']);
    renderBadge();
    expect(await screen.findByText(i18n.t('tasks.unseenTasks', { count: 3 }))).toBeInTheDocument();
    expect(i18n.t('tasks.unseenTasks', { count: 3 })).toBe('3 tasks with a new change');
    const badge = screen.getByText('3').parentElement!;
    expect(badge).toHaveClass('bg-primary');
    expect(badge).not.toHaveClass('bg-attention');
    // The two tasks with unread chats in the mock are not a second pill.
    expect(screen.queryByText('2')).not.toBeInTheDocument();
  });

  it('shows nothing when no task has an unseen change', async () => {
    mockApi([]);
    renderBadge();
    await vi.waitFor(() => expect(unseenCalls).toBe(1));
    expect(screen.queryByText(/new change/)).not.toBeInTheDocument();
  });

  it('task and seen events refetch the unseen ids once after the debounce', async () => {
    mockApi(['t1']);
    renderBadge();
    await screen.findByText(i18n.t('tasks.unseenTasks', { count: 1 }));
    expect(unseenCalls).toBe(1);
    vi.useFakeTimers();
    const event = { task: { groupId: 'g1' }, actor: { id: 'x', name: 'X' } };
    act(() => {
      fire(BoardEvents.task, event);
      fire(SeenEvents.changed, { kind: 'task', id: 't1' });
      fire(BoardEvents.task, { ...event, task: { groupId: 'other' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BOARD_UNSEEN_DEBOUNCE_MS - 1);
    });
    expect(unseenCalls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    await vi.waitFor(() => expect(unseenCalls).toBe(2));
  });
});
