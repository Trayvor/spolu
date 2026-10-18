import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { i18n } from '@/i18n';
import { createAppRouter } from '@/router';
import { ADMIN, CLIENT, fakeSocket, mockTicketApi, reply } from '@/features/tickets/test-api';
import { OfflineStrip } from './offline-strip';
import { RoutePending } from './route-pending';

const socket = fakeSocket();
vi.mock('@/lib/socket', () => ({
  getSocket: () => socket,
  connectSocket: vi.fn(),
  disconnectSocket: vi.fn(),
}));

const t = (key: string, opts?: Record<string, unknown>) => i18n.t(key, opts);

/** The viewport of a phone (the media query `(max-width: 640px)` matches). */
function phone() {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query.includes('max-width: 640px'),
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList,
  );
}

function renderApp(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const bar = () => screen.queryByRole('navigation', { name: t('bottomNav.label') });

/** A fake `visualViewport` the test resizes. */
function fakeViewport(height: number) {
  const listeners = new Set<() => void>();
  const viewport = {
    height,
    addEventListener: (_: string, fn: () => void) => listeners.add(fn),
    removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
  };
  vi.stubGlobal('visualViewport', viewport);
  return (next: number) => {
    viewport.height = next;
    act(() => listeners.forEach((fn) => fn()));
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the phone bottom bar, admin', () => {
  const api = () =>
    mockTicketApi(ADMIN, [
      (url) =>
        url.pathname === '/api/tickets/global'
          ? reply(200, { items: [], nextCursor: null })
          : url.pathname === '/api/me/home/counts'
            ? reply(200, { tasks: 3, tickets: 120 })
            : undefined,
    ]);

  it('shows Home, Groups, Tasks, Tickets and More with the header counts', async () => {
    phone();
    api();
    renderApp('/tickets');
    const nav = await screen.findByRole('navigation', { name: t('bottomNav.label') });
    const names = [...within(nav).getAllByRole('link'), ...within(nav).getAllByRole('button')].map(
      (el) => el.textContent?.replace(/\d+\+?Nové: \d+/, ''),
    );
    expect(names).toEqual([
      t('nav.home'),
      t('nav.groups'),
      t('nav.tasks'),
      t('nav.tickets'),
      t('bottomNav.more'),
    ]);
    const counts = await within(nav).findAllByTestId('bottom-nav-count');
    expect(counts.map((c) => c.textContent)).toEqual([
      `3${t('bottomNav.count', { count: 3 })}`,
      `99+${t('bottomNav.count', { count: 120 })}`,
    ]);
    expect(within(nav).getByRole('link', { name: new RegExp(t('nav.tickets')) })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('opens the other sections under More', async () => {
    phone();
    api();
    renderApp('/tickets');
    const nav = await screen.findByRole('navigation', { name: t('bottomNav.label') });
    await userEvent.click(within(nav).getByRole('button', { name: t('bottomNav.more') }));
    const sheet = await screen.findByRole('dialog');
    const rows = within(sheet)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(rows).toContain(t('nav.knowledge'));
    expect(rows).toContain(t('nav.bulkEmail'));
    expect(rows).not.toContain(t('nav.tasks'));
  });

  it('is not there on a wide screen', async () => {
    api();
    renderApp('/tickets');
    await screen.findByRole('heading', { name: t('tickets.global.title') });
    expect(bar()).toBeNull();
  });

  it('hides while the keyboard is open and comes back', async () => {
    phone();
    api();
    vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800);
    const resize = fakeViewport(800);
    renderApp('/tickets');
    await screen.findByRole('navigation', { name: t('bottomNav.label') });
    resize(480);
    expect(bar()).toBeNull();
    resize(800);
    expect(bar()).not.toBeNull();
  });

  it('steps aside on a ticket page', async () => {
    phone();
    api();
    renderApp('/tickets/k1');
    await waitFor(() => expect(screen.queryByRole('banner')).not.toBeNull());
    expect(bar()).toBeNull();
  });
});

describe('the phone bottom bar, client', () => {
  it('shows Chat, Tasks, Tickets, Knowledge with the Chat and Tasks counts', async () => {
    phone();
    mockTicketApi(CLIENT, [
      (url) => {
        if (url.pathname === '/api/groups/g1/chat') {
          return reply(200, { id: 'ch1', lastSeq: 9, unread: 4, lastReadAt: null });
        }
        if (url.pathname === '/api/groups/g1/board/unseen') {
          return reply(200, { taskIds: ['t1', 't2'], messageTaskIds: [] });
        }
        return undefined;
      },
    ]);
    renderApp('/groups/g1/knowledge');
    const nav = await screen.findByRole('navigation', { name: t('bottomNav.label') });
    const labels = within(nav)
      .getAllByRole('link')
      .map((a) => a.textContent?.replace(/\d+Nové: \d+/, ''));
    expect(labels).toEqual([
      t('group.tabs.chat'),
      t('group.tabs.tasks'),
      t('group.tabs.tickets'),
      t('group.tabs.knowledge'),
    ]);
    for (const [tab, count] of [
      ['chat', 4],
      ['tasks', 2],
    ] as const) {
      await waitFor(() =>
        expect(
          within(nav).getByRole('link', { name: new RegExp(t(`group.tabs.${tab}`)) }),
        ).toHaveTextContent(`${count}${t('bottomNav.count', { count })}`),
      );
    }
  });
});

describe('the route pending bar', () => {
  it('shows after a short wait while a route loads and goes when it is ready', async () => {
    let finish: () => void = () => undefined;
    const root = createRootRoute({ component: RoutePending });
    const slow = createRoute({
      getParentRoute: () => root,
      path: '/slow',
      loader: () => new Promise<void>((resolve) => (finish = resolve)),
    });
    const home = createRoute({ getParentRoute: () => root, path: '/' });
    const router = createRouter({
      routeTree: root.addChildren([home, slow]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(router.state.status).toBe('idle'));
    expect(screen.queryByRole('progressbar')).toBeNull();
    void router.navigate({ to: '/slow' } as never);
    expect(await screen.findByRole('progressbar', { name: t('nav.loading') })).toBeInTheDocument();
    act(() => finish());
    await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
  });
});

describe('the offline strip', () => {
  it('appears offline, says what is true and goes when the connection is back', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    render(<OfflineStrip />);
    expect(screen.queryByRole('status')).toBeNull();
    online.mockReturnValue(false);
    act(() => window.dispatchEvent(new Event('offline')));
    expect(screen.getByRole('status')).toHaveTextContent(t('nav.offline'));
    online.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event('online')));
    expect(screen.queryByRole('status')).toBeNull();
  });
});
