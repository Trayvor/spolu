import { describe, expect, it } from 'vitest';
import {
  EmailChangeConfirmSchema,
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

  it('prefs patch needs at least one known key', () => {
    expect(NotificationPrefsPatchSchema.safeParse({ pushEnabled: false }).success).toBe(true);
    expect(NotificationPrefsPatchSchema.safeParse({}).success).toBe(false);
    expect(NotificationPrefsPatchSchema.safeParse({ other: true }).success).toBe(false);
  });
});
