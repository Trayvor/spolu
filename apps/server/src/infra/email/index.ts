import type { Config } from '../config/config.js';
import { createElasticSender } from './elastic-sender.js';
import type { EmailSender } from './email.js';
import { createSmtpSender } from './smtp-sender.js';

export { EmailSendError } from './email.js';
export type { EmailMessage, EmailSender } from './email.js';

export function createEmailSender(
  config: Config['email'],
  fetchImpl: typeof fetch = fetch,
): EmailSender {
  return config.driver === 'smtp'
    ? createSmtpSender(config)
    : createElasticSender(config, fetchImpl);
}
