import nodemailer, { type Transporter } from 'nodemailer';
import { BulkSendError, type BulkEmailSender, type BulkMessage } from './bulk.js';

/**
 * Bulk email over SMTP, for development, tests and e2e (Mailpit). It adds Spolu's own
 * RFC 8058 headers, so Mailpit shows them and the one-click flow can be tested. No provider
 * ids. `transport` lets tests pass a nodemailer stream transport.
 */
export function createSmtpBulkSender(
  opts: {
    host: string;
    port: number;
    secure?: boolean;
    auth?: { user: string; pass: string };
    from: string;
  },
  transport: Transporter = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure ?? false,
    ...(opts.auth ? { auth: opts.auth } : {}),
  }),
): BulkEmailSender {
  return {
    unsubscribeHref: (url) => url,

    async send(msg: BulkMessage) {
      try {
        await transport.sendMail({
          from: opts.from,
          to: msg.to[0],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          headers: {
            'List-Unsubscribe': `<${msg.oneClickUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          },
        });
      } catch (err) {
        throw new BulkSendError(
          `SMTP send failed: ${err instanceof Error ? err.message : String(err)}`,
          true,
          null,
        );
      }
      return { transactionId: null, messageId: null };
    },
  };
}
