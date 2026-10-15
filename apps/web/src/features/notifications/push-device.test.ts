import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({
  savePushSubscription: vi.fn(() => Promise.resolve()),
  deletePushSubscription: vi.fn(() => Promise.resolve()),
}));

import { deletePushSubscription, savePushSubscription } from './api';
import {
  forgetThisDevice,
  getDeviceState,
  iosVersion,
  isIosOutsideHomeScreen,
  subscribeThisDevice,
} from './push-device';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const MAC_IPAD =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36';

const KEY = 'AQAB';
type Sub = { endpoint: string; toJSON: () => unknown; unsubscribe: () => Promise<boolean> };

function stubBrowser(opts: {
  ua?: string;
  standalone?: boolean;
  permission?: NotificationPermission;
  sub?: Sub | null;
}) {
  const sub = opts.sub ?? null;
  const newSub: Sub = {
    endpoint: 'https://fcm.googleapis.com/x',
    toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/x', keys: { p256dh: 'a', auth: 'b' } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(sub)),
    subscribe: vi.fn(() => Promise.resolve(newSub)),
  };
  vi.stubGlobal('navigator', {
    userAgent: opts.ua ?? ANDROID,
    platform: 'Linux',
    maxTouchPoints: 5,
    serviceWorker: { ready: Promise.resolve({ pushManager }) },
  });
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: opts.standalone ?? false })),
  );
  const requestPermission = vi.fn(() => Promise.resolve('granted' as NotificationPermission));
  vi.stubGlobal('Notification', {
    permission: opts.permission ?? 'default',
    requestPermission,
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  return { pushManager, requestPermission, newSub };
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('iosVersion', () => {
  it('reads iPhone, iPad and Mac-like iPad agents and is null on Android', () => {
    expect(iosVersion(IPHONE, { platform: 'iPhone', maxTouchPoints: 5 })).toBe(16.4);
    expect(iosVersion(IPAD, { platform: 'iPad', maxTouchPoints: 5 })).toBe(17.2);
    expect(iosVersion(MAC_IPAD, { platform: 'MacIntel', maxTouchPoints: 5 })).toBe(17.4);
    expect(iosVersion(MAC_IPAD, { platform: 'MacIntel', maxTouchPoints: 0 })).toBeNull();
    expect(iosVersion(ANDROID, { platform: 'Linux armv8l', maxTouchPoints: 5 })).toBeNull();
  });
});

describe('getDeviceState', () => {
  it('iOS Safari outside the home screen needs-home-screen', async () => {
    stubBrowser({ ua: IPHONE, standalone: false });
    expect(isIosOutsideHomeScreen()).toBe(true);
    expect(await getDeviceState()).toBe('needs-home-screen');
  });

  it('denied permission is blocked', async () => {
    stubBrowser({ permission: 'denied' });
    expect(await getDeviceState()).toBe('blocked');
  });

  it('an existing subscription is on', async () => {
    stubBrowser({
      permission: 'granted',
      sub: { endpoint: 'e', toJSON: () => ({}), unsubscribe: vi.fn() },
    });
    expect(await getDeviceState()).toBe('on');
  });

  it('no subscription is off, and no PushManager is unsupported', async () => {
    stubBrowser({ permission: 'granted' });
    expect(await getDeviceState()).toBe('off');
    vi.stubGlobal('PushManager', undefined);
    expect(await getDeviceState()).toBe('unsupported');
  });
});

describe('subscribeThisDevice', () => {
  it('asks permission only when default and posts the JSON', async () => {
    const b = stubBrowser({ permission: 'default' });
    expect(await subscribeThisDevice(KEY)).toBe('on');
    expect(b.requestPermission).toHaveBeenCalledTimes(1);
    expect(b.pushManager.subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: expect.any(Uint8Array),
    });
    expect(savePushSubscription).toHaveBeenCalledWith(b.newSub.toJSON());

    const g = stubBrowser({ permission: 'granted' });
    await subscribeThisDevice(KEY);
    expect(g.requestPermission).not.toHaveBeenCalled();
  });

  it('is blocked when permission is refused', async () => {
    const b = stubBrowser({ permission: 'default' });
    b.requestPermission.mockResolvedValueOnce('denied');
    expect(await subscribeThisDevice(KEY)).toBe('blocked');
    expect(b.pushManager.subscribe).not.toHaveBeenCalled();
  });
});

describe('forgetThisDevice', () => {
  it('deletes on the server, then unsubscribes', async () => {
    const order: string[] = [];
    vi.mocked(deletePushSubscription).mockImplementationOnce(() => {
      order.push('server');
      return Promise.resolve();
    });
    const sub: Sub = {
      endpoint: 'https://fcm.googleapis.com/x',
      toJSON: () => ({}),
      unsubscribe: vi.fn(() => {
        order.push('browser');
        return Promise.resolve(true);
      }),
    };
    stubBrowser({ permission: 'granted', sub });
    await forgetThisDevice();
    expect(deletePushSubscription).toHaveBeenCalledWith('https://fcm.googleapis.com/x');
    expect(order).toEqual(['server', 'browser']);
  });

  it('does nothing when unsupported', async () => {
    stubBrowser({});
    vi.stubGlobal('PushManager', undefined);
    await forgetThisDevice();
    expect(deletePushSubscription).not.toHaveBeenCalled();
  });
});
