import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;
const source = readFileSync(resolve(process.cwd(), 'public/push-sw.js'), 'utf8');

function setup(clientList: unknown[]) {
  const listeners: Record<string, Listener> = {};
  const self = {
    location: { origin: 'https://spolu.test' },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    registration: {
      showNotification: vi.fn<(title: string, options?: unknown) => Promise<void>>(() =>
        Promise.resolve(),
      ),
    },
    clients: {
      matchAll: vi.fn(() => Promise.resolve(clientList)),
      openWindow: vi.fn(() => Promise.resolve(null)),
    },
  };
  new Function('self', source)(self);
  const fire = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { self, fire };
}

const payload = { title: 'Acme', body: 'Hello there', url: '/groups/g1/chat', tag: 'g1' };

describe('push-sw', () => {
  afterEach(() => vi.unstubAllGlobals());
  let notification: { close: ReturnType<typeof vi.fn>; data: { url: unknown } };
  beforeEach(() => {
    notification = { close: vi.fn(), data: { url: '/groups/g1/chat' } };
  });

  it('push shows the notification with tag, body and url', async () => {
    const { self, fire } = setup([]);
    await fire('push', { data: { json: () => payload } });
    expect(self.registration.showNotification).toHaveBeenCalledWith('Acme', {
      body: 'Hello there',
      tag: 'g1',
      // 2026-10-18: a replacement of the same tag is silent unless the server asks.
      renotify: false,
      icon: '/icons/icon-192.png',
      data: { url: '/groups/g1/chat' },
    });
  });

  it('marks the app icon (N6b) where the browser has a badge, and still shows without one', async () => {
    const { self, fire } = setup([]);
    const setAppBadge = vi.fn(() => Promise.resolve());
    Object.assign(self, { navigator: { setAppBadge } });
    await fire('push', { data: { json: () => payload } });
    // A dot: the open app sets the real number from the bell's count.
    expect(setAppBadge).toHaveBeenCalledWith();
    const bare = setup([]);
    await bare.fire('push', { data: { json: () => payload } });
    expect(bare.self.registration.showNotification).toHaveBeenCalled();
    const failing = setup([]);
    Object.assign(failing.self, {
      navigator: { setAppBadge: () => Promise.reject(new Error('no')) },
    });
    await failing.fire('push', { data: { json: () => payload } });
    expect(failing.self.registration.showNotification).toHaveBeenCalled();
  });

  it('alerts again only when the payload asks for it', async () => {
    const { self, fire } = setup([]);
    await fire('push', { data: { json: () => ({ ...payload, renotify: true }) } });
    await fire('push', { data: { json: () => ({ ...payload, renotify: 'yes' }) } });
    const flags = self.registration.showNotification.mock.calls.map(
      ([, options]) => (options as { renotify: boolean }).renotify,
    );
    expect(flags).toEqual([true, false]);
  });

  it('click prefers the focused tab, then a visible one', async () => {
    const tab = (visibilityState: string, focused = false) => ({
      url: 'https://spolu.test/',
      visibilityState,
      focused,
      focus: vi.fn(() => Promise.resolve()),
      postMessage: vi.fn(),
    });
    const hidden = tab('hidden');
    const visible = tab('visible');
    const focused = tab('visible', true);
    await setup([hidden, visible]).fire('notificationclick', { notification });
    expect(visible.focus).toHaveBeenCalled();
    expect(hidden.focus).not.toHaveBeenCalled();
    await setup([hidden, visible, focused]).fire('notificationclick', { notification });
    expect(focused.focus).toHaveBeenCalled();
  });

  it('a malformed or empty payload still shows a notification', async () => {
    const { self, fire } = setup([]);
    await fire('push', {
      data: {
        json: () => {
          throw new SyntaxError('bad');
        },
      },
    });
    await fire('push', {});
    expect(self.registration.showNotification).toHaveBeenCalledTimes(2);
    expect(self.registration.showNotification.mock.calls[0]![0]).toBe('Help');
    expect(self.registration.showNotification.mock.calls[1]![0]).toBe('Help');
  });

  it('a payload without a tag gets the spolu tag (renotify needs one)', async () => {
    const { self, fire } = setup([]);
    // Like browsers: renotify without a tag rejects with a TypeError and nothing is shown.
    self.registration.showNotification.mockImplementation((_title, options) => {
      const o = options as { tag?: string; renotify?: boolean };
      return o.renotify && !o.tag
        ? Promise.reject(new TypeError('renotify needs a tag'))
        : Promise.resolve();
    });
    await fire('push', {
      data: {
        json: () => {
          throw new SyntaxError('bad');
        },
      },
    });
    await fire('push', { data: { json: () => ({ title: 'Acme', tag: '' }) } });
    const tags = self.registration.showNotification.mock.calls.map(
      ([, options]) => (options as { tag: string }).tag,
    );
    expect(tags).toEqual(['spolu', 'spolu']);
  });

  it('click focuses an open tab and posts the path', async () => {
    const client = {
      url: 'https://spolu.test/',
      focus: vi.fn(() => Promise.resolve()),
      postMessage: vi.fn(),
    };
    const { self, fire } = setup([{ url: 'https://other.test/', focus: vi.fn() }, client]);
    await fire('notificationclick', { notification });
    expect(notification.close).toHaveBeenCalled();
    expect(client.focus).toHaveBeenCalled();
    expect(client.postMessage).toHaveBeenCalledWith({
      type: 'spolu:navigate',
      url: '/groups/g1/chat',
    });
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('click opens a window when no tab is open', async () => {
    const { self, fire } = setup([]);
    await fire('notificationclick', { notification });
    expect(self.clients.openWindow).toHaveBeenCalledWith('/groups/g1/chat');
  });

  it('keeps the event id of the push; a malformed one is dropped', async () => {
    const { self, fire } = setup([]);
    await fire('push', { data: { json: () => ({ ...payload, notificationId: 'n1' }) } });
    await fire('push', { data: { json: () => ({ ...payload, notificationId: '../x' }) } });
    const data = self.registration.showNotification.mock.calls.map(
      ([, options]) => (options as { data: unknown }).data,
    );
    expect(data).toEqual([
      { url: '/groups/g1/chat', notificationId: 'n1' },
      { url: '/groups/g1/chat' },
    ]);
  });

  it('click marks the notification read with the session cookie, then tells our tabs', async () => {
    const fetch = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetch);
    const client = {
      url: 'https://spolu.test/',
      focus: vi.fn(() => Promise.resolve()),
      postMessage: vi.fn(),
    };
    const { fire } = setup([client]);
    await fire('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/groups/g1/chat', notificationId: 'n1' } },
    });
    expect(fetch).toHaveBeenCalledWith('/api/me/notifications/n1/read', {
      method: 'POST',
      credentials: 'same-origin',
    });
    expect(client.postMessage).toHaveBeenCalledWith({
      type: 'spolu:navigate',
      url: '/groups/g1/chat',
    });
    // The bell of each open tab refetches, even one that loaded before the write.
    expect(client.postMessage).toHaveBeenCalledWith({ type: 'spolu:notifications-read', id: 'n1' });
  });

  it('click still opens the app when marking read fails, and skips it without an id', async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError('offline')));
    vi.stubGlobal('fetch', fetch);
    const { self, fire } = setup([]);
    await fire('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/groups/g1/chat', notificationId: 'n1' } },
    });
    expect(self.clients.openWindow).toHaveBeenCalledWith('/groups/g1/chat');
    await fire('notificationclick', { notification });
    await fire('notificationclick', {
      notification: { close: vi.fn(), data: { url: '/', notificationId: 'a/../b' } },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('a foreign url opens / instead', async () => {
    const { self, fire } = setup([]);
    const urls = [
      'https://evil.test/x',
      '//evil.test/x',
      '/\t/evil.test',
      'javascript:alert(1)',
      42,
    ];
    for (const url of urls) {
      notification.data.url = url;
      await fire('notificationclick', { notification });
    }
    expect(self.clients.openWindow.mock.calls).toEqual(urls.map(() => ['/']));
  });
});
