export type EmailMessage = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
  /**
   * Extra headers, e.g. the weekly summary's `List-Unsubscribe` (RFC 8058); the transactional
   * senders pass them through.
   */
  headers?: Record<string, string>;
};

export interface EmailSender {
  send(msg: EmailMessage): Promise<void>;
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmailSendError';
  }
}
