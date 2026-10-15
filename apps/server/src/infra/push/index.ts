import type { Config } from '../config/config.js';
import { createFakePushSender } from './fake-push-sender.js';
import type { PushSender } from './push.js';
import { createWebPushSender } from './web-push-sender.js';

export { PushSendError } from './push.js';
export type { PushSender, PushTarget } from './push.js';
export { createFakePushSender } from './fake-push-sender.js';
export type { FakePushSender } from './fake-push-sender.js';

/** null when push is not configured: callers skip push and the web hides the toggle. */
export function createPushSender(config: Config['push']): PushSender | null {
  if (config === null) return null;
  return config.provider === 'webpush'
    ? createWebPushSender(config)
    : createFakePushSender(config.file);
}
