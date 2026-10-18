import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { sessionQuery } from '@/features/auth/use-session';
import SavedViewsBar from '@/features/saved-views/saved-views-bar';
import { setLanguage } from '@/i18n';
import { loadNamespace } from '@/i18n/namespaces';
import { rememberedFiltersKey } from '@/lib/use-remembered-filters';
import { useFinancePageFilters } from './page-filters';
import { currentMonth } from './period';
import { FINANCE_FILTER_KEYS, validateFinanceSearch } from './search';

/** `/finance`'s filters in the URL (2026-10-18): links, saved views, the remembered ones. */

const key = (list: string) => rememberedFiltersKey('u1', list);
const remember = (list: string, value: object) =>
  localStorage.setItem(key(list), JSON.stringify(value));

const latest = {} as { current: ReturnType<typeof useFinancePageFilters> };
function Page() {
  const filters = useFinancePageFilters();
  useEffect(() => {
    latest.current = filters;
  });
  return (
    <>
      <output data-testid="range">{JSON.stringify(filters.period.range)}</output>
      <SavedViewsBar page="finance" keys={FINANCE_FILTER_KEYS} />
    </>
  );
}

async function renderPage(path: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } }),
    ),
  );
  const root = createRootRoute();
  const page = createRoute({
    getParentRoute: () => root,
    path: '/finance',
    validateSearch: validateFinanceSearch,
    component: Page,
  });
  const router = createRouter({
    routeTree: root.addChildren([page]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, { id: 'u1', finance: true } as never);
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await router.load();
  return { router, user: userEvent.setup() };
}

const search = (router: { state: { location: { search: unknown } } }) =>
  router.state.location.search as Record<string, unknown>;

beforeAll(async () => {
  await setLanguage('en');
  await loadNamespace('savedViews');
});
beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe('validateFinanceSearch', () => {
  it('keeps the filters and the open item, drops what is not valid', () => {
    expect(
      validateFinanceSearch({ clients: 'a,b', internal: 0, period: 'custom', from: '2026-01' }),
    ).toEqual({
      clients: 'a,b',
      internal: undefined,
      period: 'custom',
      from: '2026-01',
      to: undefined,
      item: undefined,
    });
    expect(
      validateFinanceSearch({ internal: '0', period: 'thisYear', from: '2026-01', item: 'i1' }),
    ).toEqual({
      clients: undefined,
      internal: 0,
      period: undefined,
      from: undefined,
      to: undefined,
      item: 'i1',
    });
    expect(validateFinanceSearch({ period: 'custom', from: 'nope', to: 5 }).from).toBeUndefined();
  });
});

describe('/finance filters in the URL', () => {
  it('reads the URL and writes every change into it', async () => {
    const { router } = await renderPage('/finance?clients=a,b&period=lastMonth');
    expect(latest.current.clients).toEqual({ clients: ['a', 'b'], internal: true });
    expect(latest.current.period.period).toBe('lastMonth');

    act(() => latest.current.setClients({ clients: [], internal: false }));
    await waitFor(() => expect(search(router)).toMatchObject({ internal: 0, period: 'lastMonth' }));
    expect(search(router).clients).toBeUndefined();

    act(() => latest.current.period.choose('custom'));
    const month = currentMonth();
    await waitFor(() =>
      expect(search(router)).toMatchObject({ period: 'custom', from: month, to: month }),
    );
    act(() => latest.current.period.setCustom({ from: '2026-01', to: '2026-03' }));
    await waitFor(() =>
      expect(screen.getByTestId('range')).toHaveTextContent('{"from":"2026-01","to":"2026-03"}'),
    );

    // Back to the defaults: nothing in the URL, nothing remembered.
    act(() => latest.current.period.choose('thisYear'));
    act(() => latest.current.setClients({ clients: [], internal: true }));
    await waitFor(() => expect(search(router)).toEqual({}));
    await waitFor(() => expect(localStorage.getItem(key('finance.page'))).toBeNull());
  });

  it('restores the last filters into an empty URL, keeping an old link’s open item', async () => {
    remember('finance.page', { clients: 'a', period: 'lastYear' });
    const { router } = await renderPage('/finance?item=i1');
    await waitFor(() =>
      expect(search(router)).toMatchObject({ clients: 'a', period: 'lastYear', item: 'i1' }),
    );
    expect(latest.current.clients.clients).toEqual(['a']);
  });

  it('a link with filters wins over the remembered ones', async () => {
    remember('finance.page', { clients: 'a', period: 'lastYear' });
    const { router } = await renderPage('/finance?period=thisMonth');
    expect(latest.current.period.period).toBe('thisMonth');
    expect(search(router).clients).toBeUndefined();
    await waitFor(() =>
      expect(JSON.parse(localStorage.getItem(key('finance.page'))!)).toEqual({
        period: 'thisMonth',
      }),
    );
  });

  it('moves the filters remembered before the URL into it, once', async () => {
    remember('finance.clients', { internal: '0' });
    remember('finance.page.period', { value: 'lastMonth' });
    const { router } = await renderPage('/finance');
    await waitFor(() => expect(search(router)).toEqual({ internal: 0, period: 'lastMonth' }));
    expect(localStorage.getItem(key('finance.clients'))).toBeNull();
    expect(localStorage.getItem(key('finance.page.period'))).toBeNull();
  });

  it('moves a remembered custom range too', async () => {
    remember('finance.clients', { clients: 'a,b' });
    remember('finance.page.period', { value: 'lastYear' });
    remember('finance.page.period.custom', { from: '2026-02', to: '2026-04' });
    const { router } = await renderPage('/finance');
    await waitFor(() =>
      expect(search(router)).toEqual({
        clients: 'a,b',
        period: 'custom',
        from: '2026-02',
        to: '2026-04',
      }),
    );
  });

  it('has the "This month" starter view', async () => {
    const { router, user } = await renderPage('/finance?period=lastYear&item=i1');
    await user.click(await screen.findByRole('button', { name: 'This month' }));
    await waitFor(() => expect(search(router)).toEqual({ period: 'thisMonth' }));
    expect(screen.getByRole('button', { name: 'This month' })).toHaveAttribute(
      'aria-current',
      'true',
    );
  });
});
