import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  AdminEvents,
  ChatEvents,
  SeenEvents,
  TicketEvents,
  type SidebarClient,
} from '@spolu/shared';
import { homeKeys } from './api';
import { patchSidebar, useSidebarLive } from './use-sidebar-live';

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
const fire = (event: string, payload: unknown) =>
  act(() => handlers.get(event)?.forEach((fn) => fn(payload)));

/** A row; its `nameRank` (the server's name order) defaults to the name's place in `RANKS`. */
const RANKS = ['Aa', 'Admin', 'Alpha', 'Beta', 'Bravo', 'Cyan', 'Delta', 'One', 'Two'];
const row = (groupId: string, name: string, extra: Partial<SidebarClient> = {}): SidebarClient => ({
  groupId,
  name,
  hasLogo: false,
  updatedAt: '2026-10-18T00:00:00.000Z',
  managed: false,
  section: 'client',
  unread: 0,
  unseenTasks: 0,
  unseenTickets: 0,
  nameRank: RANKS.indexOf(name) + 1,
  ...extra,
});

describe('patchSidebar', () => {
  const list = [
    row('i', 'Admin', { section: 'internal' }),
    row('m1', 'Beta', { managed: true }),
    row('o1', 'Alpha', { unread: 2 }),
    row('o2', 'Cyan'),
    row('o3', 'Delta'),
  ];

  it('replaces a row in place when its order does not change', () => {
    const next = patchSidebar(list, new Set(['o2']), [row('o2', 'Cyan', { hasLogo: true })]);
    expect(next.map((c) => c.groupId)).toEqual(['i', 'm1', 'o1', 'o2', 'o3']);
    expect(next[3]!.hasLogo).toBe(true);
  });

  it('moves a row that got a badge up, by name rank among those with one', () => {
    const next = patchSidebar(list, new Set(['o3']), [row('o3', 'Delta', { unseenTasks: 1 })]);
    expect(next.map((c) => c.groupId)).toEqual(['i', 'm1', 'o1', 'o3', 'o2']);
    const first = patchSidebar(list, new Set(['o2']), [row('o2', 'Aa', { unread: 1 })]);
    expect(first.map((c) => c.groupId)).toEqual(['i', 'm1', 'o2', 'o1', 'o3']);
  });

  it('drops a row the server no longer returns and adds a new one', () => {
    const next = patchSidebar(list, new Set(['o1', 'n']), [row('n', 'Bravo')]);
    expect(next.map((c) => c.groupId)).toEqual(['i', 'm1', 'n', 'o2', 'o3']);
  });

  it("keeps the server's name order and never re-sorts by name in the browser", () => {
    // The database (en_US.utf8) puts "Čistota" before "Cyril"; Slovak puts it after.
    const server = [
      row('a', 'Adam', { nameRank: 1 }),
      row('c1', 'Čistota', { nameRank: 2 }),
      row('c2', 'Cyril', { nameRank: 3 }),
      row('d', 'Dana', { nameRank: 4 }),
    ];
    const ids = (rows: SidebarClient[]) => rows.map((c) => c.groupId);
    const patched = patchSidebar(server, new Set(['c1']), [{ ...server[1]!, hasLogo: true }]);
    expect(ids(patched)).toEqual(['a', 'c1', 'c2', 'd']);
    // A rank the name would contradict still wins (ties and case are the server's call too).
    const zeta = patchSidebar(server, new Set(['z']), [row('z', 'Zeta', { nameRank: 1 })]);
    expect(ids(zeta)).toEqual(['z', 'a', 'c1', 'c2', 'd']);
  });
});

describe('useSidebarLive', () => {
  let calls: string[];
  let queryClient: QueryClient;

  function Probe() {
    useSidebarLive();
    return null;
  }

  beforeEach(() => {
    handlers.clear();
    calls = [];
    vi.useFakeTimers();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      calls.push(url);
      return new Response(JSON.stringify([row('g2', 'Two', { unread: 3 })]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    queryClient = new QueryClient();
    queryClient.setQueryData(homeKeys.sidebar, [row('g1', 'One'), row('g2', 'Two')]);
    render(
      <QueryClientProvider client={queryClient}>
        <Probe />
      </QueryClientProvider>,
    );
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('a burst of events fetches only the named groups once and patches them in', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    fire(AdminEvents.activity, { groupId: 'g2', kind: 'chat' });
    fire(ChatEvents.read, { groupId: 'g2', channelId: 'c', taskId: null, lastReadAt: '' });
    fire(TicketEvents.updated, { ticketId: 't', groupId: null });
    fire(SeenEvents.changed, { kind: 'ticket', id: 't', groupId: null });
    await act(() => vi.advanceTimersByTimeAsync(1999));
    expect(calls).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(calls).toEqual(['/api/me/home/sidebar?groups=g2']);
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(
      queryClient.getQueryData<SidebarClient[]>(homeKeys.sidebar)!.map((c) => c.groupId),
    ).toEqual(['g2', 'g1']);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('an event without a group reloads the whole list', async () => {
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    fire(SeenEvents.changed, { kind: 'task', id: 't' });
    await act(() => vi.advanceTimersByTimeAsync(2000));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: homeKeys.sidebar });
  });
});
