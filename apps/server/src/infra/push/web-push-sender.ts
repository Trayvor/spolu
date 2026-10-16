import type { PushPayload } from '@spolu/shared';
import webpush from 'web-push';
import { PushSendError, type PushSender, type PushTarget } from './push.js';

type SendFn = (
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
  payload: string,
  options: {
    vapidDetails: { subject: string; publicKey: string; privateKey: string };
    TTL: number;
    urgency: 'high';
    /** Request timeout in ms. */
    timeout: number;
  },
) => Promise<unknown>;

export function createWebPushSender(
  vapid: { publicKey: string; privateKey: string; subject: string },
  send: SendFn = webpush.sendNotification as SendFn,
): PushSender {
  return {
    async send(target: PushTarget, payload: PushPayload) {
      try {
        await send(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(payload),
          // A push service that hangs must not hold a push worker: give up after 10 s (pg-boss retries).
          { vapidDetails: vapid, TTL: 86_400, urgency: 'high', timeout: 10_000 },
        );
        return 'sent';
      } catch (error) {
        const status = (error as { statusCode?: unknown } | null)?.statusCode;
        const statusCode = typeof status === 'number' ? status : null;
        if (statusCode === 404 || statusCode === 410) return 'gone';
        throw new PushSendError(
          statusCode === null ? 'Push send failed' : `Push send failed with status ${statusCode}`,
          statusCode,
          { cause: error },
        );
      }
    },
  };
}
