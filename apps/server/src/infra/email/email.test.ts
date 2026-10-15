import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EmailSendError, createEmailSender } from './index.js';

const from = 'eHub <noreply@example.com>';
const msg = (subject: string) => ({
  to: ['a@example.com'],
  cc: ['b@example.com'],
  subject,
  html: '<p>Hello</p>',
  text: 'Hello',
});

describe('smtp sender', () => {
  it('delivers to Mailpit with To and Cc', async () => {
    const subject = `smtp-test-${randomUUID()}`;
    const sender = createEmailSender({ driver: 'smtp', host: 'localhost', port: 1025, from });
    await sender.send(msg(subject));

    const res = await fetch(
      `http://localhost:8025/api/v1/search?query=${encodeURIComponent(`subject:"${subject}"`)}`,
    );
    const body = (await res.json()) as {
      messages: { To: { Address: string }[]; Cc: { Address: string }[] }[];
    };
    expect(body.messages).toHaveLength(1);
    expect(body.messages[0]?.To.map((a) => a.Address)).toEqual(['a@example.com']);
    expect(body.messages[0]?.Cc.map((a) => a.Address)).toEqual(['b@example.com']);
  });
});

describe('elastic sender', () => {
  it('posts the v4 transactional payload', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    const sender = createEmailSender({ driver: 'elastic', apiKey: 'secret-key', from }, fetchImpl);
    await sender.send(msg('Hi'));

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://api.elasticemail.com/v4/emails/transactional');
    expect(calls[0]?.init.method).toBe('POST');
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers['X-ElasticEmail-ApiKey']).toBe('secret-key');
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      Recipients: { To: ['a@example.com'], CC: ['b@example.com'] },
      Content: {
        From: from,
        Subject: 'Hi',
        Body: [
          { ContentType: 'HTML', Content: '<p>Hello</p>' },
          { ContentType: 'PlainText', Content: 'Hello' },
        ],
      },
    });
  });

  it('rejects with EmailSendError carrying the status, never the key', async () => {
    const fetchImpl = (async () => new Response('bad recipient', { status: 400 })) as unknown as typeof fetch;
    const sender = createEmailSender({ driver: 'elastic', apiKey: 'secret-key', from }, fetchImpl);
    const err = await sender.send(msg('Hi')).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(EmailSendError);
    expect((err as Error).message).toContain('400');
    expect((err as Error).message).toContain('bad recipient');
    expect((err as Error).message).not.toContain('secret-key');
  });
});
