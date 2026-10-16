import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
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

const PREFS: NotificationPrefs = { pushEnabled: true, emailEnabled: false, vapidPublicKey: 'KEY' };

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function setup(prefs: NotificationPrefs = PREFS) {
  let current = prefs;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url !== '/api/notifications/preferences') return json({ error: 'not_found' }, 404);
    if (init?.method === 'PATCH') {
      current = { ...current, ...(JSON.parse(init.body as string) as object) };
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

const pushSwitch = () => screen.findByRole('switch', { name: 'Push notifications' });
const emailSwitch = () => screen.findByRole('switch', { name: 'Email notifications' });

describe('NotificationsSection', () => {
  beforeEach(async () => {
    await setLanguage('en');
    vi.mocked(getDeviceState).mockResolvedValue('off');
    vi.mocked(subscribeThisDevice).mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('push switch states: granted (device on), default (not set up, button), denied (blocked text with the unblock steps)', async () => {
    vi.mocked(getDeviceState).mockResolvedValue('on');
    setup();
    expect(await pushSwitch()).toBeChecked();
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

  it('turning push on with the device off asks to subscribe', async () => {
    const { patches, user } = setup({ ...PREFS, pushEnabled: false });
    const toggle = await pushSwitch();
    expect(toggle).not.toBeChecked();
    // The device state must be known before the click can ask for permission.
    await waitFor(() => expect(getDeviceState).toHaveBeenCalled());
    await user.click(toggle);

    expect(subscribeThisDevice).toHaveBeenCalledWith('KEY');
    await waitFor(() => expect(patches()).toEqual([{ pushEnabled: true }]));
    expect(await pushSwitch()).toBeChecked();
  });

  it('email switch PATCHes emailEnabled', async () => {
    const { patches, user } = setup();
    expect(
      await screen.findByText('A summary of unread messages, at most every 10 minutes'),
    ).toBeInTheDocument();
    const toggle = await emailSwitch();
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    await waitFor(() => expect(patches()).toEqual([{ emailEnabled: true }]));
    expect(await emailSwitch()).toBeChecked();
    expect(subscribeThisDevice).not.toHaveBeenCalled();
  });

  it('no VAPID key shows the unavailable text', async () => {
    setup({ ...PREFS, vapidPublicKey: null });
    expect(
      await screen.findByText('Push notifications are not available on this server'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'Push notifications' })).toBeNull();
    expect(await emailSwitch()).toBeInTheDocument();
  });
});
