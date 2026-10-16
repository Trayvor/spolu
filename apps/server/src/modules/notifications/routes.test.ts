import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  DEFAULT_CHANNELS,
  type NotificationFallback,
  type NotificationModes,
  type NotificationPrefs,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { listSubscriptions } from './push-subscriptions.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
const sub = (endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`) => ({
  endpoint,
  keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) },
});

describe('notifications API', () => {
  let test: TestApp;
  let offTest: TestApp;
  const call = (
    method: 'GET' | 'PATCH' | 'PUT' | 'POST' | 'DELETE',
    url: string,
    cookie: string,
    payload?: unknown,
    app = test.app,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: { cookie, ...headers },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function admin() {
    const e = newEmail();
    const row = await addAdmin(test.deps.db, { email: e, name: 'Admin' });
    return { id: row.id, cookie: await loginAs(test.app, e) };
  }
  async function client(groupId?: string) {
    const e = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email: e, name: 'C', role: 'client', emailVerified: true });
    if (groupId) await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, e) };
  }

  beforeAll(async () => {
    test = await buildTestApp();
    offTest = await buildTestApp({ config: { push: null } });
  });
  afterAll(async () => {
    await test.app.close();
    await offTest.app.close();
    await test.close();
    await offTest.close();
  });

  it('requires a login', async () => {
    const res = await test.app.inject({ method: 'GET', url: '/api/notifications/preferences' });
    expect(res.statusCode).toBe(401);
  });

  it('preferences default to the group defaults, every group visible, with the VAPID key', async () => {
    const a = await admin();
    const res = await call('GET', '/api/notifications/preferences', a.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json<NotificationPrefs>()).toEqual({
      channels: { chat: 'push', tasks: 'push', tickets: 'both', knowledge: 'push' },
      visibleCategories: ['chat', 'tasks', 'tickets', 'knowledge'],
      vapidPublicKey: 'test-vapid-public-key',
    });
    const off = await call(
      'GET',
      '/api/notifications/preferences',
      await loginOff(),
      undefined,
      offTest.app,
    );
    expect(off.json<NotificationPrefs>().vapidPublicKey).toBeNull();
  });

  async function loginOff() {
    const e = newEmail();
    await addAdmin(offTest.deps.db, { email: e, name: 'Admin' });
    return loginAs(offTest.app, e);
  }

  it('PATCH preferences changes one group of the caller only', async () => {
    const a = await admin();
    const b = await admin();
    const res = await call('PATCH', '/api/notifications/preferences', a.cookie, {
      category: 'chat',
      channel: 'email',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json<NotificationPrefs>().channels).toEqual({
      ...DEFAULT_CHANNELS,
      chat: 'email',
    });
    const other = await call('GET', '/api/notifications/preferences', b.cookie);
    expect(other.json<NotificationPrefs>().channels).toEqual(DEFAULT_CHANNELS);
  });

  it('two PATCHes for different groups at once both stay', async () => {
    const a = await admin();
    await Promise.all([
      call('PATCH', '/api/notifications/preferences', a.cookie, {
        category: 'chat',
        channel: 'none',
      }),
      call('PATCH', '/api/notifications/preferences', a.cookie, {
        category: 'tasks',
        channel: 'email',
      }),
    ]);
    const res = await call('GET', '/api/notifications/preferences', a.cookie);
    expect(res.json<NotificationPrefs>().channels).toMatchObject({ chat: 'none', tasks: 'email' });
  });

  it('notification-fallback adds email to push groups once, and respects a later change', async () => {
    const a = await admin();
    expect(
      (await test.app.inject({ method: 'POST', url: '/api/me/notification-fallback' })).statusCode,
    ).toBe(401);
    const first = await call('POST', '/api/me/notification-fallback', a.cookie);
    expect(first.statusCode).toBe(200);
    expect(first.json<NotificationFallback>()).toMatchObject({
      channels: { chat: 'both', tasks: 'both', tickets: 'both', knowledge: 'both' },
      turnedOn: true,
    });
    await call('PATCH', '/api/notifications/preferences', a.cookie, {
      category: 'chat',
      channel: 'push',
    });
    const again = await call('POST', '/api/me/notification-fallback', a.cookie);
    expect(again.statusCode).toBe(200);
    expect(again.json<NotificationFallback>()).toMatchObject({ turnedOn: false });
    expect(again.json<NotificationFallback>().channels.chat).toBe('push');
  });

  it('notification-fallback leaves other users alone', async () => {
    const a = await admin();
    const b = await admin();
    await call('POST', '/api/me/notification-fallback', a.cookie);
    const [row] = await test.deps.db
      .select({ channels: user.notificationChannels, emailFallbackAt: user.emailFallbackAt })
      .from(user)
      .where(eq(user.id, b.id));
    expect(row).toEqual({ channels: {}, emailFallbackAt: null });
  });

  it('PATCH preferences rejects unknown groups, channels and keys', async () => {
    const a = await admin();
    for (const body of [
      { category: 'dm', channel: 'push' },
      { category: 'chat', channel: 'sms' },
      { category: 'chat', channel: 'push', role: 'admin' },
      { emailEnabled: true },
      {},
    ]) {
      const res = await call('PATCH', '/api/notifications/preferences', a.cookie, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'validation_failed' });
    }
  });

  it('POST /push/subscriptions with a malformed endpoint answers 400', async () => {
    const a = await admin();
    const keys = { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) };
    const res = await call('POST', '/api/push/subscriptions', a.cookie, {
      endpoint: 'not a url',
      keys,
    });
    expect(res.statusCode).toBe(400);
  });

  it('modes: client default all, admin default mentions', async () => {
    const g = await createGroup(test.deps.db, { name: 'F', egrantUrl: newUrl() });
    const c = await client(g.id);
    const a = await admin();
    expect(
      (await call('GET', '/api/notifications/modes', c.cookie)).json<NotificationModes>(),
    ).toEqual({
      defaultMode: null,
      roleDefault: 'all',
      overrides: {},
      managerSet: [],
    });
    expect(
      (await call('GET', '/api/notifications/modes', a.cookie)).json<NotificationModes>()
        .roleDefault,
    ).toBe('mentions');
  });

  it('a per-group mode overrides the all-groups default', async () => {
    const g = await createGroup(test.deps.db, { name: 'F', egrantUrl: newUrl() });
    const a = await admin();
    const def = await call('PUT', '/api/notifications/modes/default', a.cookie, { mode: 'off' });
    expect(def.statusCode).toBe(200);
    const res = await call('PUT', `/api/groups/${g.id}/notification-mode`, a.cookie, {
      mode: 'all',
    });
    expect(res.statusCode).toBe(204);
    expect((await call('GET', '/api/notifications/modes', a.cookie)).json()).toEqual({
      defaultMode: 'off',
      roleDefault: 'mentions',
      overrides: { [g.id]: 'all' },
      managerSet: [],
    });
  });

  it('setting the all-groups default removes per-group rows', async () => {
    const g = await createGroup(test.deps.db, { name: 'F', egrantUrl: newUrl() });
    const a = await admin();
    await call('PUT', `/api/groups/${g.id}/notification-mode`, a.cookie, { mode: 'all' });
    const res = await call('PUT', '/api/notifications/modes/default', a.cookie, { mode: 'off' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ defaultMode: 'off', overrides: {} });
  });

  it('a bad mode answers 400', async () => {
    const g = await createGroup(test.deps.db, { name: 'F', egrantUrl: newUrl() });
    const a = await admin();
    expect(
      (await call('PUT', `/api/groups/${g.id}/notification-mode`, a.cookie, { mode: 'loud' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', '/api/notifications/modes/default', a.cookie, { mode: 'loud' }))
        .statusCode,
    ).toBe(400);
  });

  it('a client cannot set the all-groups default', async () => {
    const g = await createGroup(test.deps.db, { name: 'F', egrantUrl: newUrl() });
    const c = await client(g.id);
    const res = await call('PUT', '/api/notifications/modes/default', c.cookie, { mode: 'off' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
  });

  it('a client sets their own group mode but not another group or an unknown one', async () => {
    const mine = await createGroup(test.deps.db, { name: 'M', egrantUrl: newUrl() });
    const theirs = await createGroup(test.deps.db, { name: 'T', egrantUrl: newUrl() });
    const c = await client(mine.id);
    expect(
      (await call('PUT', `/api/groups/${mine.id}/notification-mode`, c.cookie, { mode: 'off' }))
        .statusCode,
    ).toBe(204);
    for (const id of [theirs.id, randomUUID(), 'not an id']) {
      const res = await call(
        'PUT',
        `/api/groups/${encodeURIComponent(id)}/notification-mode`,
        c.cookie,
        {
          mode: 'off',
        },
      );
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'not_found' });
    }
    const modes = (
      await call('GET', '/api/notifications/modes', c.cookie)
    ).json<NotificationModes>();
    expect(modes.overrides).toEqual({ [mine.id]: 'off' });
  });

  it('one user setting a mode does not touch another', async () => {
    const g = await createGroup(test.deps.db, { name: 'F', egrantUrl: newUrl() });
    const a = await admin();
    const b = await admin();
    await call('PUT', `/api/groups/${g.id}/notification-mode`, a.cookie, { mode: 'off' });
    await call('PUT', '/api/notifications/modes/default', a.cookie, { mode: 'all' });
    expect((await call('GET', '/api/notifications/modes', b.cookie)).json()).toEqual({
      defaultMode: null,
      roleDefault: 'mentions',
      overrides: {},
      managerSet: [],
    });
  });

  it('subscription saved and deleted by its owner only', async () => {
    const a = await admin();
    const b = await admin();
    const s = sub();
    const save = await call('POST', '/api/push/subscriptions', a.cookie, s, test.app, {
      'user-agent': 'x'.repeat(400),
    });
    expect(save.statusCode).toBe(204);
    const rows = (await listSubscriptions(test.deps.db, [a.id])).get(a.id) ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userAgent).toHaveLength(300);

    const foreign = await call('DELETE', '/api/push/subscriptions', b.cookie, {
      endpoint: s.endpoint,
    });
    expect(foreign.statusCode).toBe(204);
    expect((await listSubscriptions(test.deps.db, [a.id])).get(a.id)).toHaveLength(1);

    const own = await call('DELETE', '/api/push/subscriptions', a.cookie, { endpoint: s.endpoint });
    expect(own.statusCode).toBe(204);
    expect((await listSubscriptions(test.deps.db, [a.id])).get(a.id)).toBeUndefined();
  });

  it('the same endpoint saved by another user moves to that user', async () => {
    const a = await admin();
    const b = await admin();
    const s = sub();
    await call('POST', '/api/push/subscriptions', a.cookie, s);
    await call('POST', '/api/push/subscriptions', b.cookie, s);
    const map = await listSubscriptions(test.deps.db, [a.id, b.id]);
    expect(map.get(a.id)).toBeUndefined();
    expect(map.get(b.id)).toHaveLength(1);
  });

  it('invalid subscription answers invalid_subscription', async () => {
    const a = await admin();
    for (const body of [
      {},
      { endpoint: 'http://x.example.com/a', keys: sub().keys },
      { endpoint: sub().endpoint, keys: { p256dh: 'x', auth: 'y' } },
    ]) {
      const res = await call('POST', '/api/push/subscriptions', a.cookie, body);
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_subscription' });
    }
  });

  it('push unavailable answers 503 push_unavailable', async () => {
    const res = await call('POST', '/api/push/subscriptions', await loginOff(), sub(), offTest.app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ error: 'push_unavailable' });
  });
});
