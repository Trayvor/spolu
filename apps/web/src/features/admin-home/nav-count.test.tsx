import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminEvents, ChatEvents, SeenEvents, TicketEvents } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import NavCount from './nav-count';

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

let answer = { tasks: 3, tickets: 0 };
const calls: string[] = [];

function renderCounts() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <a href="/tasks">
        Tasks <NavCount kind="tasks" live />
      </a>
      <a href="/tickets">
        Tickets <NavCount kind="tickets" />
      </a>
    </QueryClientProvider>,
  );
}

describe('NavCount', () => {
  beforeEach(async () => {
    await setLanguage('en');
    handlers.clear();
    calls.length = 0;
    answer = { tasks: 3, tickets: 0 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        calls.push(url);
        return new Response(JSON.stringify(answer), { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('shows the count with a spoken label, nothing at 0, one request for both', async () => {
    renderCounts();
    const tasks = await screen.findByTestId('nav-count-tasks');
    expect(tasks).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /Tasks/ })).toHaveAccessibleName(
      `Tasks ${i18n.t('adminHome.navCount.tasks', { count: 3 })}`,
    );
    expect(screen.queryByTestId('nav-count-tickets')).toBeNull();
    expect(calls).toEqual(['/api/me/home/counts']);
  });

  it('caps at 99+', async () => {
    answer = { tasks: 0, tickets: 120 };
    renderCounts();
    expect(await screen.findByTestId('nav-count-tickets')).toHaveTextContent('99+');
  });

  it('chat activity, a ticket event or seen:changed refetches after 2 s; a read does not', async () => {
    renderCounts();
    await screen.findByTestId('nav-count-tasks');
    vi.useFakeTimers();
    act(() =>
      handlers.get(ChatEvents.read)?.forEach((fn) => fn({ groupId: 'g1', channelId: 'c' })),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).toHaveLength(1);
    // A task chat message is an unseen change (2026-10-17).
    act(() =>
      handlers.get(AdminEvents.activity)?.forEach((fn) => fn({ groupId: 'g1', kind: 'chat' })),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).toHaveLength(2);
    act(() => handlers.get(SeenEvents.changed)?.forEach((fn) => fn({ kind: 'task', id: 't' })));
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).toHaveLength(3);
    answer = { tasks: 3, tickets: 2 };
    act(() =>
      handlers.get(TicketEvents.created)?.forEach((fn) => fn({ ticketId: 'k', groupId: null })),
    );
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(calls).toHaveLength(4);
    // React Query batches its notifications on a timer: let it flush before the real clock.
    await act(() => vi.advanceTimersByTimeAsync(100));
    vi.useRealTimers();
    expect(await screen.findByTestId('nav-count-tickets')).toHaveTextContent('2');
  });
});
