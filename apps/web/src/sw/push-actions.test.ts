import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown) => void;
const read = (name: string) => readFileSync(resolve(process.cwd(), `public/${name}`), 'utf8');
// The order of vite.config.ts's importScripts.
const sources = [read('push-actions.js'), read('push-sw.js')];

type FetchCall = [string, RequestInit];

function setup(answer: () => Promise<Response> = () => Promise.resolve(new Response('{}'))) {
  const listeners: Record<string, Listener> = {};
  const fetch = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(answer);
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
      matchAll: vi.fn(() => Promise.resolve([])),
      openWindow: vi.fn(() => Promise.resolve(null)),
    },
  };
  vi.stubGlobal('fetch', fetch);
  for (const source of sources) new Function('self', source)(self);
  const fire = async (type: string, event: Record<string, unknown>) => {
    const waits: Promise<unknown>[] = [];
    listeners[type]!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  /** Shows the push, then clicks `action` on the card it made. */
  const clickAction = async (payload: object, action: string, reply?: string) => {
    await fire('push', { data: { json: () => payload } });
    const [, options] = self.registration.showNotification.mock.calls.at(-1)!;
    const notification = { close: vi.fn(), data: (options as { data: unknown }).data };
    await fire('notificationclick', { notification, action, reply });
  };
  return { self, fire, fetch, clickAction };
}

const base = {
  title: 'Report · Firma',
  body: 'Urgent',
  url: '/groups/g1/tasks/t1',
  tag: 'task:t1',
};
const done = { ...base, actions: [{ action: 'done', title: 'Hotovo', taskId: 't1' }] };
const reply = {
  ...base,
  url: '/groups/g1/chat?message=m1',
  tag: 'chat:c1',
  actions: [
    {
      action: 'reply',
      title: 'Odpovedať',
      placeholder: 'Napíšte odpoveď…',
      channelId: 'c1',
      parentId: null,
      url: '/groups/g1/chat?message=m1&c=c1&reply=1',
    },
  ],
};
const json = (body: object, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('push-actions (N6a)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the buttons with their titles; a reply asks for inline text', async () => {
    const { self, fire } = setup();
    await fire('push', { data: { json: () => done } });
    await fire('push', { data: { json: () => reply } });
    const [first, second] = self.registration.showNotification.mock.calls.map(
      ([, options]) => options as { actions: unknown[]; data: { url: string } },
    );
    expect(first!.actions).toEqual([{ action: 'done', title: 'Hotovo' }]);
    expect(first!.data.url).toBe('/groups/g1/tasks/t1');
    expect(second!.actions).toEqual([
      { action: 'reply', title: 'Odpovedať', type: 'text', placeholder: 'Napíšte odpoveď…' },
    ]);
  });

  it('drops malformed buttons; a payload without any shows none', async () => {
    const { self, fire } = setup();
    const bad = [
      { action: 'done', title: 'X', taskId: '../admin' },
      { action: 'delete', title: 'X', taskId: 't1' },
      { action: 'reply', title: 'X', channelId: 'c1', parentId: 5, url: '/x' },
      { action: 'time', title: '', url: '/x' },
      null,
    ];
    await fire('push', { data: { json: () => ({ ...base, actions: bad }) } });
    await fire('push', { data: { json: () => base } });
    for (const [, options] of self.registration.showNotification.mock.calls) {
      expect(options).not.toHaveProperty('actions');
      expect((options as { data: unknown }).data).toEqual({ url: '/groups/g1/tasks/t1' });
    }
  });

  it('"Done" posts the task, bodyless, with the session cookie, and opens nothing', async () => {
    const { self, fetch, clickAction } = setup(() => json({ id: 't1', askTime: false }));
    await clickAction(done, 'done');
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as FetchCall;
    expect(url).toBe('/api/tasks/t1/done');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', headers: {} });
    expect(init.body).toBeUndefined();
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('"Done" asked for time opens the time dialog; a refusal or no network opens the task', async () => {
    let s = setup(() => json({ id: 't1', askTime: true }));
    await s.clickAction(done, 'done');
    expect(s.self.clients.openWindow).toHaveBeenCalledWith('/groups/g1/tasks/t1?time=1');

    for (const answer of [
      () => json({ error: 'not_found' }, 404),
      () => json({ error: 'unauthorized' }, 401),
      () => Promise.reject(new TypeError('offline')),
    ]) {
      s = setup(answer);
      await s.clickAction(done, 'done');
      expect(s.self.clients.openWindow).toHaveBeenCalledWith('/groups/g1/tasks/t1');
    }
  });

  it('"Log time" opens its URL, the time dialog', async () => {
    const { self, fetch, clickAction } = setup();
    const time = {
      ...base,
      actions: [{ action: 'time', title: 'Zapísať čas', url: '/groups/g1/tasks/t1?time=1' }],
    };
    await clickAction(time, 'time');
    expect(fetch).not.toHaveBeenCalled();
    expect(self.clients.openWindow).toHaveBeenCalledWith('/groups/g1/tasks/t1?time=1');
  });

  it('an inline reply is sent to the channel (in the thread); nothing opens', async () => {
    const { self, fetch, clickAction } = setup(() => json({ id: 'm2' }, 201));
    await clickAction(reply, 'reply', '  Ďakujem  ');
    const thread = { ...reply, actions: [{ ...reply.actions[0]!, parentId: 'r1' }] };
    await clickAction(thread, 'reply', 'V threade');
    const [[url, init], [, threadInit]] = fetch.mock.calls as [FetchCall, FetchCall];
    expect(url).toBe('/api/channels/c1/messages');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
    });
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ body: 'Ďakujem', clientId: expect.any(String) });
    expect(JSON.parse(threadInit.body as string)).toMatchObject({
      body: 'V threade',
      parentId: 'r1',
    });
    expect(self.clients.openWindow).not.toHaveBeenCalled();
  });

  it('a reply without inline text, or one the server refused, opens the composer', async () => {
    let s = setup();
    await s.clickAction(reply, 'reply');
    await s.clickAction(reply, 'reply', '   ');
    expect(s.fetch).not.toHaveBeenCalled();
    expect(s.self.clients.openWindow.mock.calls).toEqual([
      ['/groups/g1/chat?message=m1&c=c1&reply=1'],
      ['/groups/g1/chat?message=m1&c=c1&reply=1'],
    ]);
    s = setup(() => json({ error: 'forbidden' }, 403));
    await s.clickAction(reply, 'reply', 'Ahoj');
    expect(s.self.clients.openWindow).toHaveBeenCalledWith(
      '/groups/g1/chat?message=m1&c=c1&reply=1',
    );
  });

  it('a click on the card, or an unknown button, opens the item; foreign URLs open /', async () => {
    const { self, fetch, clickAction } = setup();
    await clickAction(done, '');
    await clickAction(done, 'reply');
    const foreign = {
      ...base,
      actions: [{ action: 'time', title: 'T', url: 'https://evil.test/' }],
    };
    await clickAction(foreign, 'time');
    expect(fetch).not.toHaveBeenCalled();
    expect(self.clients.openWindow.mock.calls).toEqual([
      ['/groups/g1/tasks/t1'],
      ['/groups/g1/tasks/t1'],
      ['/'],
    ]);
  });
});
