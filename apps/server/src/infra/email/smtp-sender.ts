import nodemailer from 'nodemailer';
import { EmailSendError, type EmailMessage, type EmailSender } from './email.js';

export function createSmtpSender(opts: {
  host: string;
  port: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  from: string;
}): EmailSender {
  const transport = nodemailer.createTransport({
    host: opts.host,
    port: opts.port,
    secure: opts.secure ?? false,
    ...(opts.auth ? { auth: opts.auth } : {}),
  });
  return {
    async send(msg: EmailMessage) {
      try {
        await transport.sendMail({
          from: opts.from,
          to: msg.to,
          cc: msg.cc,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          // Elastic's documented marker for transactional mail over SMTP: login codes and
          // notifications must reach people who unsubscribed from bulk email (P5).
          headers: { IsTransactional: 'True' },
        });
      } catch (err) {
        throw new EmailSendError(
          `SMTP send failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  };
}
