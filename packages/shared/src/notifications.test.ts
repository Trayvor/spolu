import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CHANNELS,
  EmailChangeConfirmSchema,
  NotificationCategories,
  resolveChannels,
  wantsEmail,
  wantsPush,
  effectiveGroupMode,
  NotificationPrefsPatchSchema,
  PushSubscriptionBodySchema,
  roleDefaultMode,
} from './index.js';

describe('group modes', () => {
  it('role defaults', () => {
    expect(roleDefaultMode('client')).toBe('all');
    expect(roleDefaultMode('admin')).toBe('mentions');
    expect(roleDefaultMode('superadmin')).toBe('mentions');
  });

  it('override beats the user default, which beats the role default', () => {
    expect(effectiveGroupMode({ override: null, defaultMode: null, role: 'client' })).toBe('all');
    expect(effectiveGroupMode({ override: null, defaultMode: 'off', role: 'client' })).toBe('off');
    expect(effectiveGroupMode({ override: 'all', defaultMode: 'off', role: 'admin' })).toBe('all');
  });

  it('the admin group falls back to all before the user default; an override still wins', () => {
    const admin = { role: 'admin' as const, adminGroup: true };
    expect(effectiveGroupMode({ ...admin, override: null, defaultMode: null })).toBe('all');
    expect(effectiveGroupMode({ ...admin, override: null, defaultMode: 'off' })).toBe('all');
    expect(effectiveGroupMode({ ...admin, override: 'mentions', defaultMode: null })).toBe(
      'mentions',
    );
  });
});

describe('schemas', () => {
  it('push subscription body', () => {
    const ok = {
      endpoint: 'https://fcm.googleapis.com/x',
      keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) },
    };
    expect(PushSubscriptionBodySchema.safeParse(ok).success).toBe(true);
    expect(
      PushSubscriptionBodySchema.safeParse({ ...ok, endpoint: 'http://x.test/1' }).success,
    ).toBe(false);
    expect(
      PushSubscriptionBodySchema.safeParse({ ...ok, keys: { ...ok.keys, p256dh: 'A'.repeat(86) } })
        .success,
    ).toBe(false);
    expect(PushSubscriptionBodySchema.parse({ ...ok, expirationTime: null })).toEqual(ok);
  });

  it('a malformed endpoint is a validation failure, not a throw', () => {
    const keys = { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) };
    for (const endpoint of ['not a url', '', 'https://']) {
      expect(PushSubscriptionBodySchema.safeParse({ endpoint, keys }).success).toBe(false);
    }
    expect(PushSubscriptionBodySchema.safeParse({ endpoint: 'not a url' }).success).toBe(false);
  });

  it('push endpoints only on known push services', () => {
    const keys = { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) };
    const accepts = (endpoint: string) =>
      PushSubscriptionBodySchema.safeParse({ endpoint, keys }).success;
    for (const ok of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://android.googleapis.com/gcm/send/abc',
      'https://web.push.apple.com/abc',
      'https://push.apple.com/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://push.services.mozilla.com/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect(accepts(ok), ok).toBe(true);
    }
    for (const bad of [
      'https://localhost/x',
      'https://127.0.0.1/x',
      'https://10.0.0.5/x',
      'https://[::1]/x',
      'https://db.internal/x',
      'https://example.com/x',
      'https://evilpush.apple.com.example.com/x',
      'https://notpush.apple.com/x',
      'https://evil-fcm.googleapis.com/x',
      'https://user@fcm.googleapis.com/x',
      'https://fcm.googleapis.com:8443/x',
    ]) {
      expect(accepts(bad), bad).toBe(false);
    }
  });

  it('email change confirm', () => {
    expect(
      EmailChangeConfirmSchema.parse({ newEmail: ' New@X.sk ', code: '012345' }).newEmail,
    ).toBe('new@x.sk');
    expect(EmailChangeConfirmSchema.safeParse({ newEmail: 'a@x.sk', code: '12345' }).success).toBe(
      false,
    );
  });

  it('prefs patch accepts one group and channel, refuses others', () => {
    const ok = (body: unknown) => NotificationPrefsPatchSchema.safeParse(body).success;
    expect(ok({ category: 'tickets', channel: 'none' })).toBe(true);
    expect(ok({ category: 'dm', channel: 'push' })).toBe(false);
    expect(ok({ category: 'chat', channel: 'sms' })).toBe(false);
    expect(ok({ category: 'chat', channel: 'push', x: 1 })).toBe(false);
    expect(ok({})).toBe(false);
  });
});

describe('notification groups', () => {
  it('defaults: tickets both, the rest push', () => {
    expect(resolveChannels({})).toEqual({
      chat: 'push',
      tasks: 'push',
      tickets: 'both',
      knowledge: 'push',
      meetings: 'push',
      finance: 'push',
    });
    expect(DEFAULT_CHANNELS).toEqual(resolveChannels({}));
  });

  it('keeps valid choices and ignores garbage', () => {
    expect(resolveChannels({ chat: 'none', tasks: 5, knowledge: 'loud', x: 'email' })).toEqual({
      chat: 'none',
      tasks: 'push',
      tickets: 'both',
      knowledge: 'push',
      meetings: 'push',
      finance: 'push',
    });
    expect(resolveChannels(null)).toEqual(DEFAULT_CHANNELS);
    expect(resolveChannels(['email'])).toEqual(DEFAULT_CHANNELS);
  });

  it.each([
    ['email', false, true],
    ['push', true, false],
    ['both', true, true],
    ['none', false, false],
  ] as const)('%s: push %s, email %s', (channel, push, email) => {
    expect(wantsPush(channel)).toBe(push);
    expect(wantsEmail(channel)).toBe(email);
  });

  it('groups are in the profile order', () => {
    expect([...NotificationCategories]).toEqual([
      'chat',
      'tasks',
      'tickets',
      'knowledge',
      'meetings',
      'finance',
    ]);
  });
});
