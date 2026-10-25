import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BulkSendError, createBulkSender, createFakeBulkSender, type BulkMessage } from './bulk.js';
import { createElasticBulkSender } from './bulk-elastic.js';
import { createSmtpBulkSender } from './bulk-smtp.js';

const FROM_BULK = 'eGrant <info@egrant.sk>';
const smtp = {
  driver: 'smtp' as const,
  host: '127.0.0.1',
  port: 1025,
  secure: false,
  from: 'Help by eGrant <noreply@example.com>',
};
const elastic = (unsubscribe: 'elastic' | 'spolu', webhookSecret: string | null = null) => ({
  driver: 'elastic' as const,
  apiKey: 'secret-key',
  from: FROM_BULK,
  unsubscribe,
  webhookSecret,
});

const msg: BulkMessage = {
  to: ['jana@example.com'],
  subject: 'News',
  html: '<p>Hello</p>',
  text: 'Hello',
  idempotencyKey: 'c1:u1',
  postback: 'c1:u1',
  unsubscribeUrl: 'https://spolu.test/unsubscribe/u1.c1.sig',
  oneClickUrl: 'https://spolu.test/api/bulk-email/unsubscribe/u1.c1.sig/one-click',
};

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: () => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond();
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const ok = () =>
  new Response(JSON.stringify({ TransactionID: 'tx-1', MessageID: 'msg-1' }), { status: 200 });

async function errorOf(promise: Promise<unknown>): Promise<BulkSendError> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BulkSendError);
  return err as BulkSendError;
}

describe('elastic bulk sender', () => {
  it('tracks opens and clicks only when the webhook secret is set (someone receives the events)', async () => {
    const { fetchImpl, calls } = fakeFetch(ok);
    await createBulkSender(elastic('elastic', 'whsec_0123456789abcdef'), smtp, fetchImpl).send(msg);
    const body = JSON.parse(String(calls[0]!.init.body)) as { Options: unknown };
    expect(body.Options).toEqual({ TrackOpens: true, TrackClicks: true });
    expect(String(calls[0]!.init.body)).not.toContain('whsec_');
  });

  it('posts to /v4/emails with one recipient, MAIL_FROM_BULK, Postback and no tracking', async () => {
    const { fetchImpl, calls } = fakeFetch(ok);
    await createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.elasticemail.com/v4/emails');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      Recipients: [{ Email: 'jana@example.com' }],
      Content: {
        From: FROM_BULK,
        Subject: 'News',
        Body: [
          { ContentType: 'HTML', Content: '<p>Hello</p>' },
          { ContentType: 'PlainText', Content: 'Hello' },
        ],
        Postback: 'c1:u1',
      },
      Options: { TrackOpens: false, TrackClicks: false },
    });
  });

  it('sends Idempotency-Key and X-ElasticEmail-ApiKey', async () => {
    const { fetchImpl, calls } = fakeFetch(ok);
    await createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['X-ElasticEmail-ApiKey']).toBe('secret-key');
    expect(headers['Idempotency-Key']).toBe('c1:u1');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('returns TransactionID and MessageID', async () => {
    const { fetchImpl } = fakeFetch(ok);
    const result = await createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg);
    expect(result).toEqual({ transactionId: 'tx-1', messageId: 'msg-1' });
  });

  it('returns null ids when the answer has none', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('', { status: 200 }));
    const result = await createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg);
    expect(result).toEqual({ transactionId: null, messageId: null });
  });

  it.each([500, 502, 503, 429, 409])('%i is retryable', async (status) => {
    const { fetchImpl } = fakeFetch(() => new Response('busy', { status }));
    const err = await errorOf(createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg));
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(status);
  });

  it('a network error is retryable without a status', async () => {
    const fetchImpl = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    const err = await errorOf(createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg));
    expect(err).toMatchObject({ retryable: true, status: null });
  });

  it('a timeout is retryable', async () => {
    const fetchImpl = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      })) as unknown as typeof fetch;
    const sender = createElasticBulkSender(elastic('elastic'), fetchImpl, 30);
    const err = await errorOf(sender.send(msg));
    expect(err).toMatchObject({ retryable: true, status: null });
    expect(err.message).not.toContain('secret-key');
  });

  it('400 is not retryable and the message carries the response text but never the API key', async () => {
    const { fetchImpl } = fakeFetch(
      () => new Response('Invalid recipient (key secret-key)', { status: 400 }),
    );
    const err = await errorOf(createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg));
    expect(err).toMatchObject({ retryable: false, status: 400 });
    expect(err.message).toContain('400');
    expect(err.message).toContain('Invalid recipient');
    expect(err.message).not.toContain('secret-key');
  });

  it('422 (same key, other body) is not retryable', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('mismatch', { status: 422 }));
    const err = await errorOf(createBulkSender(elastic('elastic'), smtp, fetchImpl).send(msg));
    expect(err).toMatchObject({ retryable: false, status: 422 });
  });

  it('elastic mode: unsubscribeHref wraps as {unsubscribe:url} and no List-Unsubscribe in Content.Headers', async () => {
    const { fetchImpl, calls } = fakeFetch(ok);
    const sender = createBulkSender(elastic('elastic'), smtp, fetchImpl);
    expect(sender.unsubscribeHref(msg.unsubscribeUrl)).toBe(`{unsubscribe:${msg.unsubscribeUrl}}`);
    await sender.send(msg);
    const body = JSON.parse(String(calls[0]!.init.body)) as { Content: { Headers?: unknown } };
    expect(body.Content.Headers).toBeUndefined();
  });

  it('spolu mode: unsubscribeHref returns the url and Content.Headers has List-Unsubscribe and List-Unsubscribe-Post', async () => {
    const { fetchImpl, calls } = fakeFetch(ok);
    const sender = createBulkSender(elastic('spolu'), smtp, fetchImpl);
    expect(sender.unsubscribeHref(msg.unsubscribeUrl)).toBe(msg.unsubscribeUrl);
    await sender.send(msg);
    const body = JSON.parse(String(calls[0]!.init.body)) as { Content: { Headers?: unknown } };
    expect(body.Content.Headers).toEqual({
      'List-Unsubscribe': `<${msg.oneClickUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    });
  });
});

describe('smtp bulk sender', () => {
  afterEach(() => vi.restoreAllMocks());

  /** Sends through a nodemailer stream transport and returns the raw message. */
  async function rawMessage(): Promise<{ raw: string; result: unknown }> {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const spy = vi.spyOn(transport, 'sendMail');
    const sender = createSmtpBulkSender({ ...smtp, from: FROM_BULK }, transport);
    const result = await sender.send(msg);
    const info = (await spy.mock.results[0]!.value) as { message: Buffer };
    return { raw: info.message.toString('utf8'), result };
  }

  it('adds List-Unsubscribe <oneClickUrl> and List-Unsubscribe-Post: List-Unsubscribe=One-Click', async () => {
    const { raw } = await rawMessage();
    const unfolded = raw.replace(/\r?\n[ \t]+/g, ' ');
    expect(unfolded).toContain(`List-Unsubscribe: <${msg.oneClickUrl}>`);
    expect(unfolded).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    expect(unfolded).toContain('From: eGrant <info@egrant.sk>');
    expect(unfolded).toContain('To: jana@example.com');
    expect(unfolded).not.toContain('IsTransactional');
  });

  it('returns null ids', async () => {
    const { result } = await rawMessage();
    expect(result).toEqual({ transactionId: null, messageId: null });
  });

  it('unsubscribeHref returns the url', () => {
    const sender = createBulkSender({ driver: 'smtp', from: FROM_BULK }, smtp);
    expect(sender.unsubscribeHref(msg.unsubscribeUrl)).toBe(msg.unsubscribeUrl);
  });

  it('wraps a transport failure as a retryable BulkSendError', async () => {
    const transport = nodemailer.createTransport({ streamTransport: true });
    vi.spyOn(transport, 'sendMail').mockRejectedValue(new Error('connection refused'));
    const err = await errorOf(
      createSmtpBulkSender({ ...smtp, from: FROM_BULK }, transport).send(msg),
    );
    expect(err).toMatchObject({ retryable: true, status: null });
  });

  it('createBulkSender refuses the smtp driver without SMTP settings', () => {
    expect(() =>
      createBulkSender(
        { driver: 'smtp', from: FROM_BULK },
        { driver: 'elastic', apiKey: 'k', from: 'x' },
      ),
    ).toThrow();
  });
});

describe('fake bulk sender', () => {
  it('records sent messages and counts calls per key', async () => {
    const fake = createFakeBulkSender();
    await fake.send(msg);
    expect(fake.sent).toEqual([msg]);
    expect(fake.callsByKey.get('c1:u1')).toBe(1);
    expect(fake.unsubscribeHref('u')).toBe('u');
  });

  it('failNext fails the next call with a status or a network error', async () => {
    const fake = createFakeBulkSender();
    fake.failNext(503);
    fake.failNext(400);
    fake.failNext('network');
    expect(await errorOf(fake.send(msg))).toMatchObject({ retryable: true, status: 503 });
    expect(await errorOf(fake.send(msg))).toMatchObject({ retryable: false, status: 400 });
    expect(await errorOf(fake.send(msg))).toMatchObject({ retryable: true, status: null });
    await fake.send(msg);
    expect(fake.sent).toHaveLength(1);
    expect(fake.callsByKey.get('c1:u1')).toBe(4);
  });

  it('a repeated key replays the first answer and delivers once, like Elastic', async () => {
    const fake = createFakeBulkSender();
    const first = await fake.send(msg);
    const second = await fake.send(msg);
    expect(second).toEqual(first);
    expect(fake.sent).toHaveLength(1);
    expect(fake.callsByKey.get('c1:u1')).toBe(2);
  });
});
