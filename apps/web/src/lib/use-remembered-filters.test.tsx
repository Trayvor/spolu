import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  useSearch,
} from '@tanstack/react-router';
import { sessionQuery } from '@/features/auth/use-session';
import {
  rememberedFiltersKey,
  useRememberedFilters,
  useRememberedState,
} from './use-remembered-filters';

type ListSearch = { status?: string; mine?: 1; q?: string };
const KEYS = ['status', 'mine'] as const;
/** Every first render's search, as the list would use it for its first request. */
let firstSeen: ListSearch[] = [];

function List({ list }: { list: string }) {
  const raw = useSearch({ strict: false }) as ListSearch;
  const search = useRememberedFilters(list, KEYS, raw);
  firstSeen.push(search);
  return <output aria-label="search">{JSON.stringify(search)}</output>;
}

function renderList(path: string, { user = 'u1', list = 'tickets' } = {}) {
  const queryClient = new QueryClient();
  queryClient.setQueryData(sessionQuery.queryKey, {
    id: user,
    name: 'Ann',
    email: 'a@example.com',
    role: 'admin',
    groups: [],
  } as never);
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/list',
    validateSearch: (s: Record<string, unknown>): ListSearch => ({
      status: typeof s.status === 'string' ? s.status : undefined,
      mine: s.mine === 1 || s.mine === '1' ? 1 : undefined,
      q: typeof s.q === 'string' ? s.q : undefined,
    }),
    component: () => <List list={list} />,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
  return router;
}

const saved = (user = 'u1', list = 'tickets') => {
  const raw = localStorage.getItem(rememberedFiltersKey(user, list));
  return raw === null ? null : JSON.parse(raw);
};

describe('useRememberedFilters', () => {
  beforeEach(() => {
    localStorage.clear();
    firstSeen = [];
  });
  afterEach(() => vi.restoreAllMocks());

  it('saves the filters in the URL, per user and list, without free text', async () => {
    renderList('/list?status=all&mine=1&q=budget');
    await waitFor(() => expect(saved()).toEqual({ status: 'all', mine: 1 }));
    expect(saved('u2')).toBeNull();
  });

  it('a list opened without filters gets the saved ones, in the URL and on the first render', async () => {
    localStorage.setItem(rememberedFiltersKey('u1', 'tickets'), '{"status":"resolved"}');
    const router = renderList('/list?q=x');
    await screen.findByLabelText('search');
    expect(firstSeen[0]).toMatchObject({ status: 'resolved', q: 'x' });
    await waitFor(() =>
      expect(router.state.location.search).toEqual({ status: 'resolved', q: 'x' }),
    );
    expect(router.history.length).toBe(1); // replace, no extra history entry
  });

  it('filters in the URL win over the saved ones and replace them', async () => {
    localStorage.setItem(rememberedFiltersKey('u1', 'tickets'), '{"status":"resolved"}');
    const router = renderList('/list?mine=1');
    await screen.findByLabelText('search');
    expect(firstSeen[0]).toEqual({ mine: 1 });
    await waitFor(() => expect(saved()).toEqual({ mine: 1 }));
    expect(router.state.location.search).toEqual({ mine: 1 });
  });

  it('clearing every filter forgets the saved value', async () => {
    const router = renderList('/list?status=all');
    await waitFor(() => expect(saved()).toEqual({ status: 'all' }));
    await act(() => router.navigate({ to: '/list' as never, search: {} as never }));
    await waitFor(() => expect(saved()).toBeNull());
    expect(screen.getByLabelText('search')).toHaveTextContent('{}');
  });

  it('another user and another list have their own memory', async () => {
    localStorage.setItem(rememberedFiltersKey('u1', 'tickets'), '{"status":"resolved"}');
    renderList('/list', { user: 'u2' });
    await screen.findByLabelText('search');
    expect(firstSeen[0]).toEqual({});
    cleanup();
    renderList('/list', { list: 'tickets:g2' });
    await screen.findByLabelText('search');
    expect(firstSeen.at(-1)).toEqual({});
  });

  it('blocked or broken storage is ignored', async () => {
    localStorage.setItem(rememberedFiltersKey('u1', 'tickets'), 'not json');
    renderList('/list');
    await screen.findByLabelText('search');
    expect(firstSeen[0]).toEqual({});
    cleanup();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderList('/list?status=all');
    await screen.findByLabelText('search');
    expect(firstSeen.at(-1)).toEqual({ status: 'all' });
  });
});

describe('useRememberedState', () => {
  beforeEach(() => localStorage.clear());

  function wrapper({ children }: { children: ReactNode }) {
    const queryClient = new QueryClient();
    queryClient.setQueryData(sessionQuery.queryKey, { id: 'u1' } as never);
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  const VALID = ['sent', 'failed'] as const;

  it('starts from the saved value, saves changes and forgets null', () => {
    localStorage.setItem(rememberedFiltersKey('u1', 'report:c1'), '{"value":"failed"}');
    const { result } = renderHook(() => useRememberedState('report:c1', VALID), { wrapper });
    expect(result.current[0]).toBe('failed');
    act(() => result.current[1]('sent'));
    expect(result.current[0]).toBe('sent');
    expect(localStorage.getItem(rememberedFiltersKey('u1', 'report:c1'))).toBe('{"value":"sent"}');
    act(() => result.current[1](null));
    expect(localStorage.getItem(rememberedFiltersKey('u1', 'report:c1'))).toBeNull();
  });

  it('ignores a saved value that is no longer valid', () => {
    localStorage.setItem(rememberedFiltersKey('u1', 'report:c1'), '{"value":"gone"}');
    const { result } = renderHook(() => useRememberedState('report:c1', VALID), { wrapper });
    expect(result.current[0]).toBeNull();
  });
});
