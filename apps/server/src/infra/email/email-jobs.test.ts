import { describe, expect, it } from 'vitest';
import { EMAIL_JOB, emailJobHandlers, sendEmailLater, type EmailMessage } from './index.js';

const msg: EmailMessage = { to: ['a@example.com'], subject: 's', html: '<p>h</p>', text: 'h' };

describe('email jobs', () => {
  it('the email.send handler sends the message through the sender', async () => {
    const sent: EmailMessage[] = [];
    await emailJobHandlers({ send: async (m) => void sent.push(m) })[EMAIL_JOB]!(msg);
    expect(sent).toEqual([msg]);
  });

  it('sendEmailLater queues an email.send job with the message', async () => {
    const queued: { name: string; data: object }[] = [];
    await sendEmailLater({ send: async (name, data) => void queued.push({ name, data }) }, msg);
    expect(queued).toEqual([{ name: EMAIL_JOB, data: msg }]);
  });

  it('sendEmailLater passes send options through to the queue', async () => {
    const seen: unknown[] = [];
    await sendEmailLater({ send: async (_n, _d, options) => void seen.push(options) }, msg, {
      expireInSeconds: 5,
    });
    expect(seen).toEqual([{ expireInSeconds: 5 }]);
  });
});
