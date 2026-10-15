export type EmailMessage = {
  to: string[];
  cc?: string[];
  subject: string;
  html: string;
  text: string;
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
