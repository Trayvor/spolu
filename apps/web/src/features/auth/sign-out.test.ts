import { afterEach, expect, it, vi } from 'vitest';

const { apiSend } = vi.hoisted(() => ({ apiSend: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock('@/lib/api', () => ({ apiSend }));

import { signOut } from './api';

afterEach(() => vi.unstubAllGlobals());

it('signOut completes when no service worker is registered', async () => {
  vi.stubGlobal('navigator', {
    userAgent: 'x',
    platform: 'Linux',
    maxTouchPoints: 0,
    // `ready` never settles without a registered worker.
    serviceWorker: {
      ready: new Promise(() => undefined),
      getRegistration: () => Promise.resolve(),
    },
  });
  vi.stubGlobal('PushManager', function PushManager() {});
  vi.stubGlobal('Notification', { permission: 'granted' });
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  await signOut();
  expect(apiSend).toHaveBeenCalledWith('POST', '/auth/sign-out', {});
});
