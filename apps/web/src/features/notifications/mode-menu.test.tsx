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
  groupId: 'g1',
};
const MODES: NotificationModes = { defaultMode: null, roleDefault: 'all', overrides: {} };

/** `put` decides the answer to the mode PUT: a promise to hold it, or a status. */
function setup(put: () => Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/notifications/modes' && !init?.method)
      return new Response(JSON.stringify(MODES), { status: 200 });
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
