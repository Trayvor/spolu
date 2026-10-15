import type { PushPayload } from '@spolu/shared';

/** A browser's push subscription: where to send and the keys to encrypt with. */
export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export interface PushSender {
  /** 'gone' = the subscription no longer exists (404/410): delete it. Other failures throw. */
  send(target: PushTarget, payload: PushPayload): Promise<'sent' | 'gone'>;
}

export class PushSendError extends Error {
  constructor(
    message: string,
    readonly statusCode: number | null,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'PushSendError';
  }
}
