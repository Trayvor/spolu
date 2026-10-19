import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  NotificationEvents,
  type NotificationCentreState,
  type NotificationItem,
} from '@spolu/shared';
import { setLanguage } from '@/i18n';
import { renderWithRouter } from '@/features/admin-home/test-router';
import CentreBell, { unreadText } from './centre-bell';
import { dayLabel, groupByDay } from './centre-panel';

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();
const socket = {
  on: vi.fn((event: string, fn: Handler) => {
    if (!handlers.has(event)) handlers.set(event, new Set());
    handlers.get(event)!.add(fn);
  }),
  off: vi.fn((event: string, fn: Handler) => handlers.get(event)?.delete(fn)),
};
vi.mock('@/lib/socket', () => ({ getSocket: () => socket }));

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const now = new Date();
const item = (id: string, over: Partial<NotificationItem> = {}): NotificationItem => ({
  id,
  kind: 'chat.mention',
  title: 'Firma',
  body: 'Jana: @Eva pozri',
  url: '/tickets/k1',
  createdAt: now.toISOString(),
  unread: true,
  ...over,
});

function setup(opts: { state?: NotificationCentreState; items?: NotificationItem[] } = {}) {
  let state = opts.state ?? { unread: 2, snoozedUntil: null };
  const items = opts.items ?? [item('e1'), item('e2', { unread: false, title: 'Druhá' })];
  const calls: string[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${String(init.body)}` : ''}`);
    if (url === '/api/me/notifications/state') return json(state);
    if (url.startsWith('/api/me/notifications?') || url === '/api/me/notifications')
      return json({
        items: state.unread === 0 ? items.map((i) => ({ ...i, unread: false })) : items,
        nextCursor: null,
      });
    const one = /^\/api\/me\/notifications\/([\w-]+)\/read$/.exec(url);
    if (one) {
      const found = items.find((i) => i.id === one[1]);
      if (found?.unread) state = { ...state, unread: state.unread - 1 };
      if (found) found.unread = false;
      return new Response(null, { status: 204 });
    }
    if (url === '/api/me/notifications/read') {
      state = { ...state, unread: 0 };
      return new Response(null, { status: 204 });
    }
    if (url === '/api/me/notifications/snooze') {
      const body = JSON.parse(String(init?.body)) as { for: string | null };
      state = {
        ...state,
        snoozedUntil: body.for ? new Date(Date.now() + 3600_000).toISOString() : null,
      };
      return json(state);
    }
    return json({ error: 'not_found' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  );
  return {
    calls,
    setState: (next: NotificationCentreState) => {
      state = next;
    },
    user: userEvent.setup(),
    render: () => renderWithRouter(() => <CentreBell />, '/', wrap),
  };
}

describe('the notification centre bell', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('shows the unread count, sets the app badge, and opens the list by day', async () => {
    const setAppBadge = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { setAppBadge, clearAppBadge: vi.fn(() => Promise.resolve()) });
    const { user, render } = setup();
    await render();
    const bell = await screen.findByRole('button', { name: 'Notifications, unread: 2' });
    expect(bell).toHaveTextContent('2');
    await waitFor(() => expect(setAppBadge).toHaveBeenCalledWith(2));
    await user.click(bell);
    expect(await screen.findByText('Today')).toBeInTheDocument();
    const first = screen.getByRole('menuitem', { name: /Firma/ });
    expect(first).toHaveAttribute('href', '/tickets/k1');
    expect(screen.getAllByTestId('centre-unread')).toHaveLength(1);
  });

  it('marks all as read and keeps the panel open', async () => {
    const clearAppBadge = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { setAppBadge: vi.fn(() => Promise.resolve()), clearAppBadge });
    const { calls, user, render } = setup();
    await render();
    await user.click(await screen.findByRole('button', { name: 'Notifications, unread: 2' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Mark all as read' }));
    await waitFor(() => expect(calls).toContain('POST /api/me/notifications/read {}'));
    await waitFor(() => expect(screen.queryAllByTestId('centre-unread')).toHaveLength(0));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await waitFor(() => expect(clearAppBadge).toHaveBeenCalled());
    // The menu hides the rest of the page from assistive tech while it is open.
    expect(screen.getByRole('button', { name: 'Notifications', hidden: true })).toBeInTheDocument();
  });

  it('opening an item marks it read and follows its link (2026-10-19)', async () => {
    const { calls, user, render } = setup();
    const { router } = await render();
    await user.click(await screen.findByRole('button', { name: 'Notifications, unread: 2' }));
    await user.click(await screen.findByRole('menuitem', { name: /Firma/ }));
    await waitFor(() => expect(calls).toContain('POST /api/me/notifications/e1/read {}'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/tickets/k1'));
    // The count drops at once (the open panel hides the rest of the page from assistive tech).
    const bell = { name: 'Notifications, unread: 1', hidden: true };
    expect(await screen.findByRole('button', bell)).toBeInTheDocument();
    // An item already read is not marked again.
    await user.click(await screen.findByRole('menuitem', { name: /Druhá/ }));
    expect(calls.filter((c) => c.includes('/e2/read'))).toEqual([]);
  });

  it('refetches the bell when another tab, device or the service worker read something', async () => {
    const listeners = new Set<(event: MessageEvent) => void>();
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: {
        addEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: (event: MessageEvent) => void) => listeners.delete(fn),
      },
    });
    const { setState, render } = setup();
    await render();
    await screen.findByRole('button', { name: 'Notifications, unread: 2' });
    setState({ unread: 1, snoozedUntil: null });
    act(() => handlers.get(NotificationEvents.read)?.forEach((fn) => fn({ id: 'e1' })));
    expect(await screen.findByRole('button', { name: 'Notifications, unread: 1' })).toBeVisible();
    setState({ unread: 0, snoozedUntil: null });
    act(() =>
      listeners.forEach((fn) =>
        fn(new MessageEvent('message', { data: { type: 'spolu:notifications-read', id: 'e2' } })),
      ),
    );
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('snoozes pushes for an hour and ends the snooze', async () => {
    const { calls, user, render } = setup();
    await render();
    await user.click(await screen.findByRole('button', { name: /Notifications/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Snooze for 1 hour' }));
    await waitFor(() => expect(calls).toContain('PUT /api/me/notifications/snooze {"for":"hour"}'));
    expect(await screen.findByText(/Push notifications are snoozed until/)).toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'End the snooze' }));
    await waitFor(() => expect(calls).toContain('PUT /api/me/notifications/snooze {"for":null}'));
  });

  it('says what will show when the list is empty, and links to the settings', async () => {
    const { user, render } = setup({ state: { unread: 0, snoozedUntil: null }, items: [] });
    const { router } = await render();
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    expect(await screen.findByText(/Nothing here yet/)).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Mark all as read' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Notification settings' })).toHaveAttribute(
      'href',
      '/settings/notifications',
    );
    void router;
  });
});

describe('centre helpers', () => {
  it('99+ from the cap on', () => {
    expect(unreadText(5)).toBe('5');
    expect(unreadText(100)).toBe('99+');
  });

  it('groups by day and names today and yesterday', () => {
    const t = (key: string) => key.split('.').at(-1)!;
    const at = new Date(2026, 9, 18, 12);
    const yesterday = new Date(2026, 9, 17, 9).toISOString();
    expect(dayLabel(at.toISOString(), 'en', t, at)).toBe('today');
    expect(dayLabel(yesterday, 'en', t, at)).toBe('yesterday');
    expect(dayLabel(new Date(2026, 9, 1, 9).toISOString(), 'en', t, at)).toBe('October 1');
    const days = groupByDay([
      item('a', { createdAt: at.toISOString() }),
      item('b', { createdAt: at.toISOString() }),
      item('c', { createdAt: yesterday }),
    ]);
    expect(days.map((d) => d.map((i) => i.id))).toEqual([['a', 'b'], ['c']]);
  });
});
