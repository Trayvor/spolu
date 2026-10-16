import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createMemoryHistory } from '@tanstack/react-router';
import { i18n, setLanguage } from '@/i18n';
import { createQueryClient } from '@/lib/query-client';
import { redirectToLogin } from '@/features/auth/go-to-login';
import { createAppRouter } from '@/router';

// A hand-made socket: tests fire events on it and check how the app drives it.
const fake = vi.hoisted(() => {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    handlers,
    connected: false,
    connect: vi.fn(),
    disconnect: vi.fn(),
    on(event: string, fn: (...args: unknown[]) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)?.add(fn);
    },
    off(event: string, fn: (...args: unknown[]) => void) {
      handlers.get(event)?.delete(fn);
    },
    fire(event: string, ...args: unknown[]) {
      handlers.get(event)?.forEach((fn) => fn(...args));
    },
    timeout: () => ({ emitWithAck: () => new Promise(() => undefined) }),
  };
});

vi.mock('@/lib/socket', () => ({
  getSocket: () => fake,
  connectSocket: () => fake.connect(),
  disconnectSocket: () => fake.disconnect(),
}));

const USER = {
  id: 'u1',
  name: 'Jana Nováková',
  email: 'jana@example.com',
  role: 'admin',
  groupId: null as string | null,
};

/** Fake `fetch`: `/api/me` answers from `state`, sign-out flips it to anonymous. */
function mockApi(initial: Partial<typeof USER> | null = {}) {
  const state = {
    user: initial === null ? null : { ...USER, ...initial },
    meStatus: 200,
    signOutStatus: 200,
  };
  const fetchMock = vi.fn(async (url: string) => {
    if (url === '/api/me') {
      if (state.meStatus === 401 || !state.user) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify(state.user), { status: 200 });
    }
    if (url === '/api/auth/sign-out') {
      if (state.signOutStatus !== 200) return new Response('{}', { status: state.signOutStatus });
      state.user = null;
      return new Response('{}', { status: 200 });
    }
    if (url === '/api/health') {
      if (state.meStatus === 401) {
        return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
      }
      return new Response(JSON.stringify({ status: 'ok', db: 'ok', version: 'abc' }), {
        status: 200,
      });
    }
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { state, fetchMock };
}

function renderAt(path = '/settings') {
  const holder: { router?: ReturnType<typeof createAppRouter> } = {};
  const queryClient = createQueryClient(() => {
    if (holder.router) void redirectToLogin(holder.router);
  });
  const router = createAppRouter(queryClient, createMemoryHistory({ initialEntries: [path] }));
  holder.router = router;
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { router, queryClient, user: userEvent.setup() };
}

const t = (key: string) => i18n.t(key);

describe('logged-in shell', () => {
  beforeEach(async () => {
    await setLanguage('en');
    fake.handlers.clear();
    fake.connect.mockClear();
    fake.disconnect.mockClear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('user menu shows initials, name and email', async () => {
    mockApi();
    const { user } = renderAt();
    const trigger = await screen.findByRole('button', { name: t('user.menu') });
    expect(trigger).toHaveTextContent('JN');

    await user.click(trigger);
    // The settings page behind the menu shows the name and email too: look inside the menu.
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Jana Nováková')).toBeInTheDocument();
    expect(within(menu).getByText('jana@example.com')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: t('user.logout') })).toBeInTheDocument();
  });

  it('shows the settings page and connects the socket', async () => {
    mockApi();
    renderAt();
    expect(await screen.findByRole('heading', { name: t('nav.settings') })).toBeVisible();
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('Log out calls sign-out, clears the session and goes to /login', async () => {
    const { fetchMock } = mockApi();
    const { router, queryClient, user } = renderAt();
    await user.click(await screen.findByRole('button', { name: t('user.menu') }));
    await user.click(await screen.findByRole('menuitem', { name: t('user.logout') }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    const signOut = (fetchMock.mock.calls as unknown as [string, RequestInit?][]).find(
      ([url]) => url === '/api/auth/sign-out',
    );
    expect(signOut?.[1]?.method).toBe('POST');
    expect(queryClient.getQueryData(['session'])).toBeNull();
    expect(fake.disconnect).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: t('user.menu') })).not.toBeInTheDocument();
  });

  it('a failed Log out shows a generic error and keeps the user signed in', async () => {
    const { state, fetchMock } = mockApi();
    state.signOutStatus = 500;
    const { router, user } = renderAt();
    await user.click(await screen.findByRole('button', { name: t('user.menu') }));
    await user.click(await screen.findByRole('menuitem', { name: t('user.logout') }));

    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.generic'));
    // Writes are never retried.
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/auth/sign-out')).toHaveLength(1);
    expect(router.state.location.pathname).toBe('/settings');
  });

  it('a 401 is not retried', async () => {
    const { state, fetchMock } = mockApi();
    const { router, queryClient } = renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });

    state.meStatus = 401;
    fetchMock.mockClear();
    await act(() => queryClient.invalidateQueries({ queryKey: ['health'] }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/health')).toHaveLength(1);
  });

  it('the Admins link is shown to admins only', async () => {
    mockApi({ role: 'admin' });
    renderAt();
    expect(await screen.findByRole('link', { name: t('nav.admins') })).toHaveAttribute(
      'href',
      '/admins',
    );
  });

  it('the Groups link is shown to admins only', async () => {
    mockApi({ role: 'admin' });
    renderAt();
    expect(await screen.findByRole('link', { name: t('nav.groups') })).toHaveAttribute(
      'href',
      '/groups',
    );
  });

  it('a client does not see the Groups link', async () => {
    mockApi({ role: 'client' });
    renderAt();
    await screen.findByRole('button', { name: t('user.menu') });
    expect(screen.queryByRole('link', { name: t('nav.groups') })).not.toBeInTheDocument();
  });

  it('the user menu offers Groups to admins for narrow screens', async () => {
    mockApi({ role: 'admin' });
    const { user } = renderAt();
    await user.click(await screen.findByRole('button', { name: t('user.menu') }));
    expect(await screen.findByRole('menuitem', { name: t('nav.groups') })).toBeInTheDocument();
  });

  it('admins see Home, Tasks, Knowledge, Groups, Admins in that order', async () => {
    mockApi({ role: 'admin' });
    const { user } = renderAt();
    const order = [
      t('nav.home'),
      t('nav.tasks'),
      t('nav.knowledge'),
      t('nav.groups'),
      t('nav.admins'),
    ];
    await screen.findByRole('link', { name: t('nav.admins') });
    const header = screen.getByRole('banner');
    const names = within(header)
      .getAllByRole('link')
      .map((link) => link.textContent)
      .filter((name) => order.includes(name ?? ''));
    expect(names).toEqual(order);
    expect(within(header).getByRole('link', { name: t('nav.tasks') })).toHaveAttribute(
      'href',
      '/tasks',
    );
    await user.click(screen.getByRole('button', { name: t('user.menu') }));
    const items = (await screen.findAllByRole('menuitem'))
      .map((item) => item.textContent)
      .filter((name) => order.includes(name ?? ''));
    expect(items).toEqual(order);
  });

  it('/ renders the dashboard for an admin and redirects a client to their group', async () => {
    mockApi({ role: 'admin' });
    const admin = renderAt('/');
    expect(await screen.findByRole('heading', { level: 1 })).toBeInTheDocument();
    expect(admin.router.state.location.pathname).toBe('/');
    cleanup();
    mockApi({ role: 'client', groupId: 'g1' });
    const client = renderAt('/');
    await waitFor(() => expect(client.router.state.location.pathname).toBe('/groups/g1/chat'));
  });

  it('/tasks is not found for a client', async () => {
    mockApi({ role: 'client', groupId: 'g1' });
    renderAt('/tasks');
    expect(await screen.findByRole('heading', { name: t('notFound.title') })).toBeInTheDocument();
  });

  it('a client does not see the Admins link', async () => {
    mockApi({ role: 'client' });
    renderAt();
    await screen.findByRole('button', { name: t('user.menu') });
    expect(screen.queryByRole('link', { name: t('nav.admins') })).not.toBeInTheDocument();
  });

  it('a 401 from any query sends the user to /login', async () => {
    const { state } = mockApi();
    const { router, queryClient } = renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });

    state.meStatus = 401; // from now on every call answers 401, including /api/health
    await act(() => queryClient.invalidateQueries({ queryKey: ['health'] }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(queryClient.getQueryData(['session'])).toBeNull();
  });

  it('socket connect_error unauthorized sends the user to /login and does not reconnect', async () => {
    mockApi();
    const { router, queryClient } = renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });

    act(() => fake.fire('connect_error', new Error('unauthorized')));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(queryClient.getQueryData(['session'])).toBeNull();
    expect(fake.disconnect).toHaveBeenCalled();
    expect(fake.connect).toHaveBeenCalledTimes(1);
  });

  it('server_error schedules a reconnect with growing delay and resets after connect', async () => {
    mockApi();
    const { router } = renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });
    expect(fake.connect).toHaveBeenCalledTimes(1);

    vi.useFakeTimers();
    try {
      const fail = () => act(() => fake.fire('connect_error', new Error('server_error')));
      const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

      fail();
      advance(999);
      expect(fake.connect).toHaveBeenCalledTimes(1);
      advance(1);
      expect(fake.connect).toHaveBeenCalledTimes(2); // after 1 s
      fail();
      advance(1999);
      expect(fake.connect).toHaveBeenCalledTimes(2);
      advance(1);
      expect(fake.connect).toHaveBeenCalledTimes(3); // after 2 s
      fail();
      advance(4000);
      expect(fake.connect).toHaveBeenCalledTimes(4); // after 4 s

      act(() => fake.fire('connect')); // success: the delay starts again
      fail();
      advance(1000);
      expect(fake.connect).toHaveBeenCalledTimes(5);

      // The delay is capped at 30 s: 2, 4, 8, 16, 30, 30.
      let count = 5;
      for (const delay of [2000, 4000, 8000, 16000, 30000, 30000]) {
        fail();
        advance(delay - 1);
        expect(fake.connect).toHaveBeenCalledTimes(count);
        advance(1);
        expect(fake.connect).toHaveBeenCalledTimes(++count);
      }
      expect(fake.disconnect).not.toHaveBeenCalled();
      expect(router.state.location.pathname).toBe('/settings');
    } finally {
      vi.useRealTimers();
    }
  });

  it('leaving the signed-in layout cancels a pending server_error reconnect', async () => {
    mockApi();
    renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });

    vi.useFakeTimers();
    try {
      act(() => fake.fire('connect_error', new Error('server_error'))); // timer armed: 1 s
      cleanup(); // unmounts the app, and with it the layout
      const connects = fake.connect.mock.calls.length;
      act(() => vi.advanceTimersByTime(60_000));
      expect(fake.connect).toHaveBeenCalledTimes(connects);
    } finally {
      vi.useRealTimers();
    }
  });

  it('socket connect_error server_error keeps the user signed in', async () => {
    mockApi();
    const { router } = renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });

    act(() => fake.fire('connect_error', new Error('server_error')));

    expect(router.state.location.pathname).toBe('/settings');
    expect(fake.disconnect).not.toHaveBeenCalled();
  });

  it('a server-side socket disconnect with the session gone sends the user to /login', async () => {
    const { state } = mockApi();
    const { router, queryClient } = renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });

    state.meStatus = 401; // the admin was removed
    act(() => fake.fire('disconnect', 'io server disconnect'));

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(queryClient.getQueryData(['session'])).toBeNull();
  });

  it('a server-side socket disconnect with the session intact keeps the user signed in', async () => {
    const { fetchMock } = mockApi();
    const { router } = renderAt();
    await screen.findByRole('heading', { name: t('nav.settings') });
    const before = fetchMock.mock.calls.length;

    act(() => fake.fire('disconnect', 'io server disconnect'));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBe(before + 1)); // re-checked

    expect(router.state.location.pathname).toBe('/settings');
    // Other reasons (transport close, ...) are Socket.IO's to retry: no re-check.
    act(() => fake.fire('disconnect', 'transport close'));
    expect(fetchMock.mock.calls.length).toBe(before + 1);
  });

  it('an /api/me outage shows the error page with Try again', async () => {
    const { fetchMock } = mockApi();
    fetchMock.mockImplementationOnce(async () => new Response('oops', { status: 500 }));
    const { user } = renderAt();
    expect(await screen.findByText(t('errors.generic'))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: t('errors.retry') }));
    expect(await screen.findByRole('heading', { name: t('nav.settings') })).toBeInTheDocument();
  });
});
