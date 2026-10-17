import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationPrefs } from '@spolu/shared';
import { setLanguage } from '@/i18n';

vi.mock('./push-device', () => ({
  getDeviceState: vi.fn(() => Promise.resolve('off')),
  subscribeThisDevice: vi.fn(() => Promise.resolve('on')),
}));

import { getDeviceState, subscribeThisDevice } from './push-device';
import { NotificationsSection } from './notifications-section';

const PREFS: NotificationPrefs = {
  channels: { chat: 'push', tasks: 'push', tickets: 'both', knowledge: 'push', meetings: 'push' },
  visibleCategories: ['chat', 'tasks', 'tickets', 'knowledge', 'meetings'],
  vapidPublicKey: 'KEY',
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function setup(prefs: NotificationPrefs = PREFS, opts: { failPatch?: boolean } = {}) {
  let current = prefs;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/notifications/preferences') return json({ error: 'not_found' }, 404);
    if (init?.method === 'PATCH') {
      if (opts.failPatch) return json({ error: 'internal' }, 500);
      const { category, channel } = JSON.parse(init.body as string) as {
        category: keyof NotificationPrefs['channels'];
        channel: NotificationPrefs['channels']['chat'];
      };
      current = { ...current, channels: { ...current.channels, [category]: channel } };
    }
    return json(current);
  });
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <NotificationsSection />
    </QueryClientProvider>,
  );
  const patches = () =>
    fetchMock.mock.calls
      .filter(([, init]) => init?.method === 'PATCH')
      .map(([, init]) => JSON.parse(init?.body as string) as unknown);
  return { patches, user: userEvent.setup() };
}

const select = (name: string) => screen.findByRole('combobox', { name });

describe('NotificationsSection', () => {
  beforeEach(async () => {
    await setLanguage('en');
    vi.mocked(getDeviceState).mockResolvedValue('off');
    vi.mocked(subscribeThisDevice).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('device line states: on, not set up (button), blocked (with the unblock steps)', async () => {
    vi.mocked(getDeviceState).mockResolvedValue('on');
    setup();
    expect(await screen.findByText('This device: on')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull();
    cleanup();

    vi.mocked(getDeviceState).mockResolvedValue('off');
    const second = setup();
    expect(await screen.findByText('This device: not set up')).toBeInTheDocument();
    await second.user.click(screen.getByRole('button', { name: 'Turn on for this device' }));
    expect(subscribeThisDevice).toHaveBeenCalledWith('KEY');
    expect(await screen.findByText('This device: on')).toBeInTheDocument();
    cleanup();

    vi.mocked(getDeviceState).mockResolvedValue('blocked');
    setup();
    expect(
      await screen.findByText('This device: blocked in the browser settings'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Allow notifications for this site in the browser's site settings, then reload.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull();
  });

  it('iOS hint when not standalone', async () => {
    vi.mocked(getDeviceState).mockResolvedValue('needs-home-screen');
    setup();
    expect(
      await screen.findByText(/On iPhone, notifications only work from the Home Screen app/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^This device:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on for this device' })).toBeNull();
  });

  it('one row per visible group, with its channel', async () => {
    setup();
    expect(await select('Chat')).toHaveValue('push');
    expect(await select('Task board')).toHaveValue('push');
    expect(await select('Ticket board')).toHaveValue('both');
    expect(await select('Knowledge base')).toHaveValue('push');
    expect(await select('Meetings')).toHaveValue('push');
    expect(screen.getByText('Support tickets and their conversations')).toBeInTheDocument();
    expect(
      screen.getByText('New and moved meetings, their reminders and AI summaries'),
    ).toBeInTheDocument();
    const options = within(await select('Chat')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['Email', 'Push', 'Email and push', 'None']);
    cleanup();

    setup({ ...PREFS, visibleCategories: ['tickets'] });
    expect(await select('Ticket board')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Chat' })).toBeNull();
  });

  it('a change saves that group at once', async () => {
    const { patches, user } = setup();
    await user.selectOptions(await select('Chat'), 'none');
    expect(await select('Chat')).toHaveValue('none');
    await waitFor(() => expect(patches()).toEqual([{ category: 'chat', channel: 'none' }]));
    expect(subscribeThisDevice).not.toHaveBeenCalled();
  });

  it('a failed save rolls back and says so', async () => {
    const { user } = setup(PREFS, { failPatch: true });
    await user.selectOptions(await select('Task board'), 'email');
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await waitFor(async () => expect(await select('Task board')).toHaveValue('push'));
  });

  it('two quick changes keep each other when the first answer comes last or fails', async () => {
    // The first PATCH answers after the second, with a body that does not know the second change.
    let releaseFirst: (r: Response) => void = () => undefined;
    let n = 0;
    const base = { ...PREFS };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (init?.method !== 'PATCH') return json(base);
        n += 1;
        if (n === 1) return new Promise<Response>((resolve) => (releaseFirst = resolve));
        return json({ ...base, channels: { ...base.channels, tasks: 'email' } });
      }),
    );
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <NotificationsSection />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.selectOptions(await select('Chat'), 'none');
    await user.selectOptions(await select('Task board'), 'email');
    await waitFor(async () => expect(await select('Task board')).toHaveValue('email'));
    releaseFirst(json({ error: 'internal' }, 500));
    // Only the failed group goes back; the other change stays.
    await waitFor(async () => expect(await select('Chat')).toHaveValue('push'));
    expect(await select('Task board')).toHaveValue('email');
  });

  it('choosing push while this device is not set up subscribes it first', async () => {
    const none = {
      ...PREFS,
      channels: {
        chat: 'none',
        tasks: 'none',
        tickets: 'email',
        knowledge: 'none',
        meetings: 'none',
      },
    } as const;
    const { patches, user } = setup(none);
    // No group wants push, so there is no device line yet.
    expect(await select('Knowledge base')).toHaveValue('none');
    expect(screen.queryByText(/^This device:/)).toBeNull();
    await waitFor(() => expect(getDeviceState).toHaveBeenCalled());
    await user.selectOptions(await select('Knowledge base'), 'push');
    expect(subscribeThisDevice).toHaveBeenCalledWith('KEY');
    await waitFor(() => expect(patches()).toEqual([{ category: 'knowledge', channel: 'push' }]));
    expect(await screen.findByText('This device: on')).toBeInTheDocument();
  });

  it('no VAPID key: the unavailable text, and push choices are disabled', async () => {
    setup({ ...PREFS, vapidPublicKey: null });
    expect(
      await screen.findByText('Push notifications are not available on this server'),
    ).toBeInTheDocument();
    const options = within(await select('Chat')).getAllByRole('option') as HTMLOptionElement[];
    expect(options.filter((o) => o.disabled).map((o) => o.value)).toEqual(['push', 'both']);
    expect(screen.queryByText(/^This device:/)).toBeNull();
  });
});
