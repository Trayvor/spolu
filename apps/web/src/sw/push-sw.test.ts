import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: '/groups/g1/chat' },
    });
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
    expect(self.registration.showNotification.mock.calls[0]![0]).toBe('Spolu');
    expect(self.registration.showNotification.mock.calls[1]![0]).toBe('Spolu');
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
