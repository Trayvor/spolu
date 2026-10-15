import nodemailer from 'nodemailer';
import { EmailSendError, type EmailMessage, type EmailSender } from './email.js';

export function createSmtpSender(opts: { host: string; port: number; from: string }): EmailSender {
  const transport = nodemailer.createTransport({ host: opts.host, port: opts.port, secure: false });
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
        });
      } catch (err) {
        throw new EmailSendError(`SMTP send failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}
