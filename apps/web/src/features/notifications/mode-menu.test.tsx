import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationModes } from '@spolu/shared';
import { i18n, setLanguage } from '@/i18n';
import { sessionQuery } from '@/features/auth/use-session';
import { allGroupsValue } from './all-groups-mode';
import { GroupBell } from './mode-menu';

const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);

const CLIENT = {
  id: 'u1',
  name: 'Eva',
  email: 'eva@example.com',
  role: 'client' as const,
  finance: false,
  groups: [{ id: 'g1', name: 'Firma', role: 'client' as const, hasLogo: false, updatedAt: '' }],
};
const MODES: NotificationModes = {
  defaultMode: null,
  roleDefault: 'all',
  overrides: {},
  managerSet: [],
};

/** `put` decides the answer to the mode PUT: a promise to hold it, or a status. */
function setup(put: () => Promise<Response>, getModes?: () => Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/notifications/modes' && !init?.method)
      return getModes?.() ?? new Response(JSON.stringify(MODES), { status: 200 });
    if (init?.method === 'PUT') return put();
    return new Response('{}', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(sessionQuery.queryKey, CLIENT);
  render(
    <QueryClientProvider client={queryClient}>
      <GroupBell groupId="g1" />
    </QueryClientProvider>,
  );
  return { fetchMock, queryClient, user: userEvent.setup() };
}

const bell = (mode: string) =>
  screen.findByRole('button', { name: t('notifications.mode.bellLabel', { mode }) });

describe('GroupBell', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the current mode icon and checks it in the menu', async () => {
    const { user } = setup(() => Promise.resolve(new Response(null, { status: 204 })));
    const trigger = await bell(t('notifications.mode.all'));
    expect(trigger.querySelector('svg[data-icon="bell"]')).not.toBeNull();
    await user.click(trigger);
    expect(await screen.findByRole('menuitemradio', { name: /All messages/ })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: /Off/ })).not.toBeChecked();
    expect(screen.getByText(t('notifications.mode.mentionsHint'))).toBeInTheDocument();
  });

  it('choosing a mode calls PUT and updates at once', async () => {
    const { fetchMock, user } = setup(() => new Promise<Response>(() => undefined));
    await user.click(await bell(t('notifications.mode.all')));
    await user.click(await screen.findByRole('menuitemradio', { name: /Mentions and replies/ }));
    // The request is still pending, yet the bell already shows the new mode.
    const next = await bell(t('notifications.mode.mentions'));
    expect(next.querySelector('svg[data-icon="bell-at"]')).not.toBeNull();
    const put = fetchMock.mock.calls.find(([, i]) => i?.method === 'PUT');
    expect(put?.[0]).toBe('/api/groups/g1/notification-mode');
    expect(JSON.parse(put?.[1]?.body as string)).toEqual({ mode: 'mentions' });
  });

  it('a failed save rolls back and shows the error', async () => {
    const { user } = setup(() => Promise.resolve(new Response('{}', { status: 500 })));
    await user.click(await bell(t('notifications.mode.all')));
    await user.click(await screen.findByRole('menuitemradio', { name: /^Off/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(t('errors.generic'));
    await waitFor(async () => {
      expect(await bell(t('notifications.mode.all'))).toBeInTheDocument();
    });
  });
});

describe('GroupBell review fixes', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the role default straight away while the modes load', async () => {
    setup(
      () => Promise.resolve(new Response(null, { status: 204 })),
      () => new Promise<Response>(() => undefined),
    );
    const trigger = await bell(t('notifications.mode.all'));
    expect(trigger.querySelector('svg[data-icon="bell"]')).not.toBeNull();
  });

  it('the mentions icon carries an @ glyph', async () => {
    const { queryClient } = setup(() => Promise.resolve(new Response(null, { status: 204 })));
    await bell(t('notifications.mode.all'));
    queryClient.setQueryData(['notifications', 'modes'], {
      ...MODES,
      overrides: { g1: 'mentions' },
    });
    const icon = (await bell(t('notifications.mode.mentions'))).querySelector(
      'svg[data-icon="bell-at"]',
    );
    expect(icon?.textContent).toBe('@');
  });

  it('the root is a flex box that carries the className, so the trigger adds no line box', async () => {
    setup(() => Promise.resolve(new Response(null, { status: 204 })));
    const trigger = await bell(t('notifications.mode.all'));
    const root = trigger.parentElement as HTMLElement;
    expect(root).toHaveClass('flex');
    expect(trigger).not.toHaveClass('-my-[3px]');
  });

  it('describes each mode by its hint', async () => {
    const { user } = setup(() => Promise.resolve(new Response(null, { status: 204 })));
    await user.click(await bell(t('notifications.mode.all')));
    const item = await screen.findByRole('menuitemradio', {
      name: t('notifications.mode.mentions'),
    });
    expect(item).toHaveAccessibleDescription(t('notifications.mode.mentionsHint'));
  });

  it('clears the error when the menu opens again', async () => {
    const { user } = setup(() => Promise.resolve(new Response('{}', { status: 500 })));
    await user.click(await bell(t('notifications.mode.all')));
    await user.click(await screen.findByRole('menuitemradio', { name: /^Off/ }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await user.click(await bell(t('notifications.mode.all')));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
});

describe('GroupBell manager line', () => {
  beforeEach(() => setLanguage('en'));
  afterEach(() => vi.unstubAllGlobals());

  it('shows the manager line when the group is in managerSet, not otherwise', async () => {
    const { queryClient, user } = setup(() => Promise.resolve(new Response(null, { status: 204 })));
    await user.click(await bell(t('notifications.mode.all')));
    await screen.findByRole('menu');
    expect(screen.queryByText(t('notifications.mode.managerNote'))).toBeNull();
    await user.keyboard('{Escape}');
    queryClient.setQueryData(['notifications', 'modes'], {
      ...MODES,
      overrides: { g1: 'all' },
      managerSet: ['g1'],
    });
    await user.click(await bell(t('notifications.mode.all')));
    expect(await screen.findByText(t('notifications.mode.managerNote'))).toBeInTheDocument();
  });
});

describe('allGroupsValue', () => {
  const modes = (m: Partial<NotificationModes>): NotificationModes => ({ ...MODES, ...m });

  it('same everywhere gives that mode, differing gives mixed, default with no overrides gives the default', () => {
    expect(allGroupsValue(['a', 'b'], modes({ overrides: { a: 'off', b: 'off' } }))).toBe('off');
    expect(allGroupsValue(['a', 'b'], modes({ overrides: { a: 'off' } }))).toBe('mixed');
    expect(allGroupsValue(['a', 'b'], modes({ defaultMode: 'mentions' }))).toBe('mentions');
    expect(allGroupsValue(['a', 'b'], modes({}))).toBe('all');
    expect(allGroupsValue([], modes({}))).toBe('all');
  });
});
