import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { createAppRouter } from '@/router';
import { rememberedFiltersKey } from '@/lib/use-remembered-filters';
import { mockBoardApi } from './test-api';

const saved = () => {
  const raw = localStorage.getItem(rememberedFiltersKey('a1', 'globalBoard'));
  return raw === null ? null : JSON.parse(raw);
};

vi.mock('@/lib/socket', () => ({
  getSocket: () => ({ on: vi.fn(), off: vi.fn(), emit: vi.fn(), connected: false }),
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

let desktop = true;
const original = window.matchMedia;

function renderBoard(path = '/tasks') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, user: userEvent.setup() };
}

const globalCalls = (calls: string[]) => calls.filter((u) => u.startsWith('/api/tasks/global'));

describe('BoardFilters', () => {
  beforeEach(async () => {
    await setLanguage('en');
    localStorage.clear();
    window.matchMedia = vi.fn((query: string) => ({
      // Only the filter row's query is wide; the sidebar (1024 px) stays off in these tests.
      matches: query === '(min-width: 641px)' ? desktop : false,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    window.matchMedia = original;
    vi.unstubAllGlobals();
    desktop = true;
  });

  it('every filter round-trips through the URL', async () => {
    const { calls } = mockBoardApi();
    const { router, user } = renderBoard();
    await screen.findByRole('heading', { name: t('adminHome.board.title') });
    const row = await screen.findByRole('group', { name: t('adminHome.board.filtersLabel') });

    await user.click(within(row).getByRole('button', { name: /Assignee/ }));
    await user.click(await screen.findByRole('menuitemradio', { name: 'Petra' }));
    await waitFor(() => expect(router.state.location.search).toMatchObject({ assignee: 'p1' }));

    await user.click(within(row).getByRole('button', { name: t('adminHome.board.urgent') }));
    await user.click(within(row).getByRole('button', { name: /Due/ }));
    await user.click(
      await screen.findByRole('menuitemradio', { name: t('adminHome.board.due.week') }),
    );
    await user.click(within(row).getByRole('checkbox', { name: t('adminHome.board.completed') }));
    await user.type(within(row).getByRole('searchbox'), 'budget');
    await waitFor(() =>
      expect(router.state.location.search).toMatchObject({
        assignee: 'p1',
        urgent: 1,
        due: 'week',
        completed: 1,
        q: 'budget',
      }),
    );
    await waitFor(() =>
      expect(globalCalls(calls).at(-1)).toBe(
        '/api/tasks/global?assignee=p1&urgent=1&due=week&q=budget&completed=1',
      ),
    );
    expect(within(row).getByRole('button', { name: /Assignee: Petra/ })).toBeInTheDocument();
  });

  it('"Only where I take part" toggles mine=1 in the URL and the request', async () => {
    const { calls } = mockBoardApi();
    const { router, user } = renderBoard();
    const row = await screen.findByRole('group', { name: t('adminHome.board.filtersLabel') });
    const mine = within(row).getByRole('button', { name: t('adminHome.board.mine') });
    expect(mine).toHaveAttribute('aria-pressed', 'false');

    await user.click(mine);
    await waitFor(() => expect(router.state.location.search).toEqual({ mine: 1 }));
    await waitFor(() => expect(globalCalls(calls).at(-1)).toBe('/api/tasks/global?mine=1'));
    expect(mine).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(row).getByRole('button', { name: t('adminHome.board.clear') }));
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(mine).toHaveAttribute('aria-pressed', 'false');
  });

  it('mine counts in the collapsed Filters pill', async () => {
    desktop = false;
    mockBoardApi();
    renderBoard('/tasks?mine=1&urgent=1');
    expect(
      await screen.findByRole('button', { name: t('adminHome.board.filters', { count: 2 }) }),
    ).toBeInTheDocument();
  });

  it('Clear filters appears only off-default and resets', async () => {
    mockBoardApi();
    const { router, user } = renderBoard('/tasks?urgent=1&due=overdue');
    const clear = await screen.findByRole('button', { name: t('adminHome.board.clear') });
    await waitFor(() => expect(saved()).toEqual({ urgent: 1, due: 'overdue' }));
    await user.click(clear);
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(screen.queryByRole('button', { name: t('adminHome.board.clear') })).toBeNull();
    // Cleared filters are forgotten too: the next visit starts from the defaults.
    await waitFor(() => expect(saved()).toBeNull());
  });

  it('the last filters come back on the next visit, but not the search text', async () => {
    mockBoardApi();
    renderBoard('/tasks?mine=1&due=week&q=budget');
    await screen.findByRole('group', { name: t('adminHome.board.filtersLabel') });
    await waitFor(() => expect(saved()).toEqual({ mine: 1, due: 'week' }));
    cleanup();
    const { calls } = mockBoardApi();
    const { router } = renderBoard('/tasks');
    await waitFor(() => expect(router.state.location.search).toEqual({ mine: 1, due: 'week' }));
    expect(globalCalls(calls)).toEqual(['/api/tasks/global?mine=1&due=week']);
  });

  it('under 641 px the filters collapse into one pill and a sheet', async () => {
    desktop = false;
    mockBoardApi();
    const { user } = renderBoard('/tasks?urgent=1');
    const pill = await screen.findByRole('button', {
      name: t('adminHome.board.filters', { count: 1 }),
    });
    expect(screen.queryByRole('group', { name: t('adminHome.board.filtersLabel') })).toBeNull();
    await user.click(pill);
    const sheet = await screen.findByRole('dialog', { name: t('adminHome.board.filtersTitle') });
    expect(
      within(sheet).getByRole('button', { name: t('adminHome.board.urgent') }),
    ).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(sheet).getByRole('button', { name: t('adminHome.board.close') }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('an invalid_filter answer resets the URL', async () => {
    const { reply } = mockBoardApi([
      (url) =>
        url.pathname === '/api/tasks/global' && url.searchParams.get('assignee') === 'ghost'
          ? reply(400, { error: 'invalid_filter' })
          : undefined,
    ]);
    const { router } = renderBoard('/tasks?assignee=ghost&urgent=1');
    await waitFor(() => expect(router.state.location.search).toEqual({}));
    expect(await screen.findByRole('link', { name: /Fix budget table/ })).toBeInTheDocument();
  });
});
