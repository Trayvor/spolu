import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BoardEvents } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { TasksTabBadge } from './tasks-tab-badge';

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

let mineCalls = 0;
function mockApi(open: number) {
  mineCalls = 0;
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
      if (url === '/api/groups/g1/tasks/mine-count') {
        mineCalls++;
        return reply({ open });
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

  it('shows both pills with their screen reader text', async () => {
    mockApi(4);
    renderBadge();
    expect(await screen.findByText(i18n.t('tasks.unreadTasks', { count: 2 }))).toBeInTheDocument();
    expect(
      await screen.findByText(i18n.t('tasks.assignedToYou', { count: 4 })),
    ).toBeInTheDocument();
    expect(i18n.t('tasks.assignedToYou', { count: 4 })).toBe('4 tasks assigned to you');
    const yellow = screen.getByText('4');
    expect(yellow.parentElement).toHaveClass('bg-attention');
  });

  it('a board:task event refetches mine-count once after 500 ms', async () => {
    mockApi(1);
    renderBadge();
    await screen.findByText(i18n.t('tasks.assignedToYou', { count: 1 }));
    expect(mineCalls).toBe(1);
    vi.useFakeTimers();
    const event = { task: { groupId: 'g1' }, actor: { id: 'x', name: 'X' } };
    act(() => {
      fire(BoardEvents.task, event);
      fire(BoardEvents.taskDeleted, { groupId: 'g1', taskId: 't1' });
      fire(BoardEvents.task, event);
      fire(BoardEvents.task, { ...event, task: { groupId: 'other' } });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(499);
    });
    expect(mineCalls).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    vi.useRealTimers();
    await vi.waitFor(() => expect(mineCalls).toBe(2));
  });
});
