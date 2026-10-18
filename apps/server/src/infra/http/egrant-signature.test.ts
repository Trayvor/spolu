import { createHmac } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createReplayCache,
  egrantSignature,
  EGRANT_SIGNATURE_SKEW_SECONDS,
  signEgrantRequest,
  verifyEgrantSignature,
} from './egrant-signature.js';

const SECRET = 's'.repeat(32);
const NOW = 1_800_000_000;
const sign = (timestamp: number | string, body: string, secret = SECRET) =>
  `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

describe('signEgrantRequest', () => {
  it('is HMAC-SHA256 over "<timestamp>.<raw body>", as sha256=<hex>', () => {
    expect(signEgrantRequest(SECRET, NOW, '{"a":1}')).toBe(sign(NOW, '{"a":1}'));
    expect(signEgrantRequest(SECRET, NOW, Buffer.from('{"a":1}'))).toBe(sign(NOW, '{"a":1}'));
  });
});

describe('createReplayCache', () => {
  it('remembers a signature until it expires, then forgets it', () => {
    const seen = createReplayCache(10);
    expect(seen.firstTime('a', 100, 100)).toBe(true);
    expect(seen.firstTime('a', 100, 100)).toBe(false);
    expect(seen.firstTime('a', 200, 101)).toBe(true);
  });

  it('keeps at most `max` entries, dropping the oldest', () => {
    const seen = createReplayCache(2);
    seen.firstTime('a', 100, 0);
    seen.firstTime('b', 100, 0);
    seen.firstTime('c', 100, 0);
    expect(seen.size()).toBe(2);
    expect(seen.firstTime('c', 1, 0)).toBe(false);
  });
});

describe('egrantSignature (route hooks)', () => {
  let app: FastifyInstance;
  let now = NOW;
  afterEach(async () => {
    await app.close();
    now = NOW;
  });

  async function build(secret: string | null, bodyLimit = 1024) {
    app = Fastify();
    const secrets = { tickets: null, managers: null, groups: secret, projects: null };
    app.put(
      '/hook',
      {
        // Stands in for the bearer gate: it must run before any signature check.
        onRequest: async (request, reply) => {
          if (request.headers.authorization !== 'Bearer k') {
            return reply.code(401).send({ error: 'unauthorized' });
          }
        },
        bodyLimit,
        ...egrantSignature({ egrantSigningSecrets: secrets }, 'groups', { now: () => now }),
      },
      async (request) => ({
        body: request.body,
        verified: verifyEgrantSignature({ egrantSigningSecrets: secrets }, 'groups', request),
      }),
    );
    await app.ready();
  }

  const put = (
    body: string,
    headers: Record<string, string | undefined> = {},
    authorization = 'Bearer k',
  ) =>
    app.inject({
      method: 'PUT',
      url: '/hook',
      headers: { authorization, 'content-type': 'application/json', ...headers },
      payload: body,
    });
  const signed = (body: string, timestamp: number | string = now, secret = SECRET) =>
    put(body, {
      'x-spolu-timestamp': String(timestamp),
      'x-spolu-signature': sign(timestamp, body, secret),
    });

  it('without a secret the route behaves as before: no headers needed', async () => {
    await build(null);
    const res = await put('{"a":1}');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: { a: 1 }, verified: 'off' });
  });

  it('accepts a correct signature and still parses the body', async () => {
    await build(SECRET);
    const res = await signed('{"a":1}');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ body: { a: 1 }, verified: 'ok' });
  });

  it('signs the raw bytes: whitespace and key order are part of the signature', async () => {
    await build(SECRET);
    const body = '{ "b": 2,\n  "a": "č" }';
    expect((await signed(body)).statusCode).toBe(200);
    // The same JSON re-serialised is a different signature.
    const res = await put(body, {
      'x-spolu-timestamp': String(now),
      'x-spolu-signature': sign(now, '{"b":2,"a":"č"}'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('a missing or malformed signature or timestamp is 401', async () => {
    await build(SECRET);
    const body = '{"a":1}';
    const good = sign(now, body);
    const cases: Record<string, string | undefined>[] = [
      {},
      { 'x-spolu-timestamp': String(now) },
      { 'x-spolu-signature': good },
      { 'x-spolu-timestamp': 'yesterday', 'x-spolu-signature': good },
      { 'x-spolu-timestamp': `${now}.5`, 'x-spolu-signature': good },
      { 'x-spolu-timestamp': String(now), 'x-spolu-signature': good.slice(7) },
      { 'x-spolu-timestamp': String(now), 'x-spolu-signature': 'sha1=abcd' },
      { 'x-spolu-timestamp': String(now), 'x-spolu-signature': `${good}00` },
    ];
    for (const headers of cases) {
      const res = await put(body, headers);
      expect(res.statusCode, JSON.stringify(headers)).toBe(401);
      expect(res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('a signature over another body, timestamp or secret is 401', async () => {
    await build(SECRET);
    const body = '{"a":1}';
    expect(
      (await put(body, { 'x-spolu-timestamp': String(now), 'x-spolu-signature': sign(now, '{}') }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await put(body, {
          'x-spolu-timestamp': String(now),
          'x-spolu-signature': sign(now - 1, body),
        })
      ).statusCode,
    ).toBe(401);
    expect((await signed(body, now, 't'.repeat(32))).statusCode).toBe(401);
  });

  it('accepts uppercase hex', async () => {
    await build(SECRET);
    const body = '{"a":1}';
    const res = await put(body, {
      'x-spolu-timestamp': String(now),
      'x-spolu-signature': `sha256=${sign(now, body).slice(7).toUpperCase()}`,
    });
    expect(res.statusCode).toBe(200);
  });

  it(`allows a clock skew of ±${EGRANT_SIGNATURE_SKEW_SECONDS} s and no more`, async () => {
    await build(SECRET);
    const skew = EGRANT_SIGNATURE_SKEW_SECONDS;
    expect((await signed('{"n":1}', now - skew)).statusCode).toBe(200);
    expect((await signed('{"n":2}', now + skew)).statusCode).toBe(200);
    expect((await signed('{"n":3}', now - skew - 1)).statusCode).toBe(401);
    expect((await signed('{"n":4}', now + skew + 1)).statusCode).toBe(401);
  });

  it('refuses a replay of a request already taken (same signature)', async () => {
    await build(SECRET);
    const body = '{"a":1}';
    const headers = { 'x-spolu-timestamp': String(now), 'x-spolu-signature': sign(now, body) };
    expect((await put(body, headers)).statusCode).toBe(200);
    now += 10;
    expect((await put(body, headers)).statusCode).toBe(401);
    // The same body signed again with a fresh timestamp is a new request.
    expect((await signed(body, now)).statusCode).toBe(200);
  });

  it('a bad signature does not burn the good one', async () => {
    await build(SECRET);
    const body = '{"a":1}';
    const res = await put(body, {
      'x-spolu-timestamp': String(now),
      'x-spolu-signature': sign(now, body, 't'.repeat(32)),
    });
    expect(res.statusCode).toBe(401);
    expect((await signed(body)).statusCode).toBe(200);
  });

  it('the bearer check stays first: no key is 401 before any signature is looked at', async () => {
    await build(SECRET);
    const res = await put('{"a":1}', {}, 'Bearer wrong');
    expect(res.statusCode).toBe(401);
  });

  it('keeps the route body limit', async () => {
    await build(SECRET, 64);
    const body = JSON.stringify({ junk: 'x'.repeat(100) });
    expect((await signed(body)).statusCode).toBe(413);
  });

  it('an empty body is signed as "<timestamp>."', async () => {
    await build(SECRET);
    const res = await app.inject({
      method: 'PUT',
      url: '/hook',
      headers: {
        authorization: 'Bearer k',
        'x-spolu-timestamp': String(now),
        'x-spolu-signature': sign(now, ''),
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ verified: 'ok' });
  });
});
