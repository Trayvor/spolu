import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { NotificationPrefs } from '@spolu/shared';
import { setLanguage } from '@/i18n';

vi.mock('./push-device', () => ({
  isStandalone: vi.fn(() => false),
  iosVersion: vi.fn(() => null),
  getDeviceState: vi.fn(() => Promise.resolve('off')),
  subscribeThisDevice: vi.fn(() => Promise.resolve('on')),
}));
vi.mock('@/lib/install-prompt', () => ({
  canInstall: vi.fn(() => true),
  promptInstall: vi.fn(() => Promise.resolve('accepted')),
}));
vi.mock('./api', async () => {
  const { queryOptions } = await import('@tanstack/react-query');
  return {
    notificationPrefsQuery: queryOptions({
      queryKey: ['notifications', 'preferences'],
      queryFn: vi.fn(() => Promise.resolve(PREFS)),
    }),
    requestEmailFallback: vi.fn(() => Promise.resolve({ ...WITH_EMAIL, turnedOn: true })),
  };
});
vi.mock('./prompt-rules', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./prompt-rules')>()),
  isPhone: vi.fn(() => true),
}));

const PREFS: NotificationPrefs = {
  channels: {
    chat: 'push',
    tasks: 'push',
    tickets: 'push',
    knowledge: 'push',
    meetings: 'push',
    finance: 'push',
  },
  visibleCategories: ['chat', 'tasks', 'tickets', 'knowledge', 'meetings'],
  vapidPublicKey: 'KEY',
};
const WITH_EMAIL: NotificationPrefs = {
  ...PREFS,
  channels: {
    chat: 'both',
    tasks: 'both',
    tickets: 'both',
    knowledge: 'both',
    meetings: 'both',
    finance: 'both',
  },
};

import { canInstall, promptInstall } from '@/lib/install-prompt';
import { requestEmailFallback } from './api';
import { AppPrompt } from './app-prompt';
import { STORAGE_KEYS, isPhone } from './prompt-rules';
import { getDeviceState, iosVersion, isStandalone, subscribeThisDevice } from './push-device';

function setPermission(permission: NotificationPermission) {
  vi.stubGlobal('Notification', { permission });
}

function renderPrompt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <AppPrompt />
      </QueryClientProvider>
    </StrictMode>,
  );
  return client;
}

beforeEach(async () => {
  await setLanguage('en');
  localStorage.clear();
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  setPermission('default');
  vi.mocked(isPhone).mockReturnValue(true);
  vi.mocked(isStandalone).mockReturnValue(false);
  vi.mocked(iosVersion).mockReturnValue(null);
  vi.mocked(getDeviceState).mockResolvedValue('off');
  vi.mocked(canInstall).mockReturnValue(true);
  vi.mocked(promptInstall).mockResolvedValue('accepted');
  vi.mocked(subscribeThisDevice).mockResolvedValue('on');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('AppPrompt', () => {
  it('renders in the page flow, never as a fixed or absolute overlay', async () => {
    renderPrompt();
    const banner = await screen.findByRole('region', { name: 'Install the Help app' });
    expect(banner.className).not.toMatch(/(^|\s)(\S+:)*(fixed|absolute|sticky)(\s|$)/);
    expect(banner.className).not.toMatch(/\bz-\d+/);
    expect(banner.getAttribute('style') ?? '').not.toMatch(/position/);
  });

  it('Slovak copy says upozornenia, not notifikácie', async () => {
    await setLanguage('sk');
    vi.mocked(iosVersion).mockReturnValue(17.2);
    vi.stubGlobal('PushManager', undefined);
    renderPrompt();
    const banner = await screen.findByRole('region');
    expect(banner).toHaveTextContent('aby vám chodili upozornenia');
    expect(banner).toHaveTextContent('fungujú upozornenia len z aplikácie na ploche');
    expect(banner.textContent).not.toMatch(/notifik/i);
  });

  it('Install button uses the captured event', async () => {
    renderPrompt();
    const dialog = await screen.findByRole('region', { name: 'Install the Help app' });
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(promptInstall).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('Android without the event shows the menu steps', async () => {
    vi.mocked(canInstall).mockReturnValue(false);
    renderPrompt();
    await screen.findByRole('region', { name: 'Install the Help app' });
    expect(
      screen.getByText('Open the browser menu ⋮ → Install app / Add to Home screen'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('iOS card shows the strong copy and the Share icon', async () => {
    vi.mocked(iosVersion).mockReturnValue(17.2);
    vi.stubGlobal('PushManager', undefined);
    renderPrompt();
    const dialog = await screen.findByRole('region');
    // The spec's sentence, split into the title and the line under it.
    expect(dialog).toHaveTextContent('Important: install the Help app to get notifications.');
    expect(dialog).toHaveTextContent(
      'On iPhone, notifications only work from the Home Screen app.',
    );
    expect(dialog).toHaveTextContent('Tap “Share”');
    expect(dialog).toHaveTextContent('Choose “Add to Home Screen”');
    expect(dialog).toHaveTextContent('Open the Help app from the icon');
    expect(screen.getByTestId('share-icon')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Install' })).not.toBeInTheDocument();
  });

  it('Not now stores the time and hides the card', async () => {
    renderPrompt();
    const dialog = await screen.findByRole('region');
    const before = Date.now();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(dialog).not.toBeInTheDocument();
    expect(Number(localStorage.getItem(STORAGE_KEYS.install))).toBeGreaterThanOrEqual(before);
  });

  it('Turn on subscribes inside the click and hides', async () => {
    vi.mocked(isPhone).mockReturnValue(false);
    renderPrompt();
    const dialog = await screen.findByRole('region', {
      name: 'Turn on notifications on this device',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    // Synchronously, still inside the click: the permission prompt needs the user gesture.
    expect(subscribeThisDevice).toHaveBeenCalledWith('KEY');
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
  });

  it('Not now on the enable card stores its own time', async () => {
    vi.mocked(isPhone).mockReturnValue(false);
    renderPrompt();
    await screen.findByRole('region', { name: 'Turn on notifications on this device' });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(localStorage.getItem(STORAGE_KEYS.enable)).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.install)).toBeNull();
  });

  it('iOS fallback calls the server once and shows the notice; OK stores done', async () => {
    vi.mocked(iosVersion).mockReturnValue(15.8);
    vi.stubGlobal('PushManager', undefined);
    const client = renderPrompt();
    const dialog = await screen.findByRole('region');
    expect(dialog).toHaveTextContent("Your iPhone's iOS doesn't support app notifications.");
    expect(dialog).toHaveTextContent(
      'We turned on email notifications for you. Update iOS to 16.4 or newer to get notifications on the phone.',
    );
    expect(requestEmailFallback).toHaveBeenCalledTimes(1);
    expect(client.getQueryData<NotificationPrefs>(['notifications', 'preferences'])).toEqual(
      WITH_EMAIL,
    );
    fireEvent.click(screen.getByRole('button', { name: 'OK' }));
    expect(dialog).not.toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.iosFallback)).toBe('1');
  });

  it('iOS fallback after an email opt-out says email is off', async () => {
    vi.mocked(iosVersion).mockReturnValue(15.8);
    vi.mocked(requestEmailFallback).mockResolvedValueOnce({
      ...PREFS,
      channels: {
        chat: 'none',
        tasks: 'push',
        tickets: 'none',
        knowledge: 'push',
        meetings: 'push',
        finance: 'push',
      },
      turnedOn: false,
    });
    renderPrompt();
    const dialog = await screen.findByRole('region');
    expect(dialog).toHaveTextContent('Email notifications are off');
  });

  it('iOS fallback with email already on says so', async () => {
    vi.mocked(iosVersion).mockReturnValue(15.8);
    vi.mocked(requestEmailFallback).mockResolvedValueOnce({
      ...PREFS,
      channels: { ...PREFS.channels, tickets: 'email' },
      turnedOn: false,
    });
    renderPrompt();
    const dialog = await screen.findByRole('region');
    expect(dialog).toHaveTextContent('Email notifications are already on');
    expect(dialog).not.toHaveTextContent('We turned on');
  });

  it('a failing device check shows no prompt and never asks for the email fallback', async () => {
    vi.mocked(iosVersion).mockReturnValue(17.2);
    vi.mocked(isStandalone).mockReturnValue(true);
    vi.mocked(getDeviceState).mockRejectedValue(new Error('broken'));
    renderPrompt();
    await waitFor(() => expect(getDeviceState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(requestEmailFallback).not.toHaveBeenCalled();
  });

  it('a failing install dialog falls back to the menu steps', async () => {
    vi.mocked(promptInstall).mockRejectedValue(new Error('boom'));
    renderPrompt();
    await screen.findByRole('region', { name: 'Install the Help app' });
    vi.mocked(canInstall).mockReturnValue(false);
    fireEvent.click(screen.getByRole('button', { name: 'Install' }));
    expect(
      await screen.findByText('Open the browser menu ⋮ → Install app / Add to Home screen'),
    ).toBeInTheDocument();
  });

  it('a failed Turn on shows an error in the card and logs it', async () => {
    vi.mocked(isPhone).mockReturnValue(false);
    const error = new Error('push service down');
    vi.mocked(subscribeThisDevice).mockRejectedValue(error);
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderPrompt();
    const dialog = await screen.findByRole('region', {
      name: 'Turn on notifications on this device',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Notifications could not be turned on. Try again.',
    );
    expect(dialog).toBeInTheDocument();
    expect(log).toHaveBeenCalledWith(expect.any(String), error);
  });

  it('iOS steps are a list', async () => {
    vi.mocked(iosVersion).mockReturnValue(17.2);
    renderPrompt();
    await screen.findByRole('region');
    expect(screen.getByRole('list')).toHaveAttribute('role', 'list');
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('a page that becomes visible again re-checks the 6-hour window', async () => {
    const start = Date.now();
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    renderPrompt();
    await screen.findByRole('region');
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    now.mockReturnValue(start + 6 * 60 * 60 * 1000);
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(await screen.findByRole('region')).toBeInTheDocument();
  });

  it('granted permission without a subscription re-subscribes silently', async () => {
    vi.mocked(isPhone).mockReturnValue(false);
    setPermission('granted');
    renderPrompt();
    await waitFor(() => expect(subscribeThisDevice).toHaveBeenCalledWith('KEY'));
    expect(subscribeThisDevice).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('blocked storage still shows the prompt', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderPrompt();
    const dialog = await screen.findByRole('region', { name: 'Install the Help app' });
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(dialog).not.toBeInTheDocument();
  });

  it('renders nothing without matchMedia', async () => {
    vi.stubGlobal('matchMedia', undefined);
    renderPrompt();
    await Promise.resolve();
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(getDeviceState).not.toHaveBeenCalled();
  });

  it('buttons are at least 44 px tall', async () => {
    renderPrompt();
    await screen.findByRole('region');
    for (const button of screen.getAllByRole('button')) expect(button).toHaveClass('h-11');
  });
});
