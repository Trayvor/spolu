import { createPublicKey, generateKeyPairSync, verify } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_ID, TENANT } from '../../../test/teams-graph.js';
import {
  createGraphClient,
  GraphError,
  MAX_TRANSCRIPT_BYTES,
  privateKeyFromPem,
} from './graph-client.js';
import { createTeams } from './jobs.js';

// Teams T1, token handling: the client-credentials grant with a secret or a certificate
// assertion, the in-memory cache, a 401 renewal, Retry-After and error codes.

type Call = { url: string; init: RequestInit };

function recorder(answers: ((call: Call) => Response)[]) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call = { url: String(input), init };
    calls.push(call);
    const answer = answers.shift();
    if (!answer) throw new Error(`unexpected call ${call.url}`);
    return answer(call);
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const tokenAnswer =
  (token = 'tok-1', expiresIn = 3600) =>
  () =>
    json(200, { access_token: token, expires_in: expiresIn, token_type: 'Bearer' });
const userAnswer = () => json(200, { id: 'U1', displayName: 'Jana', userPrincipalName: 'j@e.sk' });
const form = (call: Call) => new URLSearchParams(String(call.init.body));
const auth = (call: Call) => new Headers(call.init.headers).get('authorization');

const secretConfig = {
  tenantId: TENANT,
  clientId: CLIENT_ID,
  credential: { kind: 'secret' as const, secret: 'the-secret' },
};

describe('Graph client tokens', () => {
  it('gets an app-only token with the client secret and caches it in memory', async () => {
    const { calls, fetchImpl } = recorder([tokenAnswer(), userAnswer, userAnswer]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
    await graph.getUser('j@e.sk');
    await graph.getUser('j@e.sk');
    expect(calls.map((c) => c.url)).toEqual([
      `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      'https://graph.microsoft.com/v1.0/users/j%40e.sk?$select=id,displayName,userPrincipalName',
      'https://graph.microsoft.com/v1.0/users/j%40e.sk?$select=id,displayName,userPrincipalName',
    ]);
    expect(Object.fromEntries(form(calls[0]!))).toEqual({
      client_id: CLIENT_ID,
      client_secret: 'the-secret',
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    expect(auth(calls[1]!)).toBe('Bearer tok-1');
    // The secret goes only to the token endpoint.
    expect(JSON.stringify(calls.slice(1))).not.toContain('the-secret');
  });

  it('renews the token 5 minutes before it expires', async () => {
    let now = 1_000_000;
    const { calls, fetchImpl } = recorder([
      tokenAnswer('tok-1', 3600),
      userAnswer,
      tokenAnswer('tok-2', 3600),
      userAnswer,
    ]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl, now: () => now });
    await graph.getUser('a');
    now += 55 * 60_000 + 1;
    await graph.getUser('a');
    expect(auth(calls[3]!)).toBe('Bearer tok-2');
  });

  it('a 401 drops the token and tries once more with a new one', async () => {
    const { calls, fetchImpl } = recorder([
      tokenAnswer('old'),
      () => json(401, { error: { code: 'InvalidAuthenticationToken' } }),
      tokenAnswer('new'),
      userAnswer,
    ]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
    expect(await graph.getUser('a')).toMatchObject({ id: 'U1' });
    expect(auth(calls[3]!)).toBe('Bearer new');
  });

  it('signs a certificate assertion (RS256, x5t = thumbprint) instead of a secret', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    const thumbprint = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    const { calls, fetchImpl } = recorder([tokenAnswer(), userAnswer]);
    const nowMs = Date.UTC(2026, 9, 18, 12);
    const graph = createGraphClient({
      config: {
        tenantId: TENANT,
        clientId: CLIENT_ID,
        credential: { kind: 'certificate', keyPath: '/secret/teams.pem', thumbprint },
      },
      fetch: fetchImpl,
      now: () => nowMs,
      // A file with the certificate first and the key after it.
      readKey: async (path) => {
        expect(path).toBe('/secret/teams.pem');
        return `-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n${pem}`;
      },
    });
    await graph.getUser('a');
    const params = form(calls[0]!);
    expect(params.get('client_secret')).toBeNull();
    expect(params.get('client_assertion_type')).toBe(
      'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    const [header, payload, signature] = params.get('client_assertion')!.split('.');
    const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    expect(decode(header!)).toEqual({
      alg: 'RS256',
      typ: 'JWT',
      x5t: Buffer.from(thumbprint, 'hex').toString('base64url'),
    });
    const claims = decode(payload!);
    expect(claims).toMatchObject({
      aud: `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`,
      iss: CLIENT_ID,
      sub: CLIENT_ID,
      iat: nowMs / 1000,
      exp: nowMs / 1000 + 600,
    });
    expect(typeof claims.jti).toBe('string');
    const signed = verify(
      'RSA-SHA256',
      Buffer.from(`${header}.${payload}`),
      createPublicKey(publicKey.export({ type: 'spki', format: 'pem' })),
      Buffer.from(signature!, 'base64url'),
    );
    expect(signed).toBe(true);
  });

  it('a refused token is a GraphError with only the code', async () => {
    const { fetchImpl } = recorder([
      () => json(401, { error: 'invalid_client', error_description: 'AADSTS7000215 secret abc' }),
    ]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
    const error = await graph.getUser('a').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GraphError);
    expect(error).toMatchObject({ status: 401, code: 'invalid_client' });
    expect(String((error as Error).message)).not.toContain('AADSTS');
  });
});

describe('Graph client calls', () => {
  it('waits Retry-After on 429 and reports the inner error code', async () => {
    const waits: number[] = [];
    const { fetchImpl } = recorder([
      tokenAnswer(),
      () => json(429, { error: { code: 'TooManyRequests' } }, { 'retry-after': '3' }),
      () =>
        json(403, {
          error: { code: 'Forbidden', innerError: { code: 'GraphAccessToTranscriptsDisabled' } },
        }),
    ]);
    const graph = createGraphClient({
      config: secretConfig,
      fetch: fetchImpl,
      sleep: async (ms) => void waits.push(ms),
    });
    const error = await graph.listTranscripts('U1', 'M1').catch((e: unknown) => e);
    expect(waits).toEqual([3000]);
    expect(error).toMatchObject({ status: 403, code: 'GraphAccessToTranscriptsDisabled' });
  });

  it('a missing user is null, not an error', async () => {
    const { fetchImpl } = recorder([
      tokenAnswer(),
      () => json(404, { error: { code: 'NotFound' } }),
    ]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
    expect(await graph.getUser('nobody@e.sk')).toBeNull();
  });

  it('filters online meetings by an escaped JoinWebUrl and reads the organizer', async () => {
    const { calls, fetchImpl } = recorder([
      tokenAnswer(),
      () =>
        json(200, {
          value: [
            {
              id: 'M1',
              joinWebUrl: "https://teams.microsoft.com/l/meetup-join/a'b",
              participants: { organizer: { identity: { user: { id: 'ORG', tenantId: 'TEN' } } } },
            },
          ],
        }),
    ]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
    const found = await graph.findOnlineMeeting('U1', {
      joinWebUrl: "https://teams.microsoft.com/l/meetup-join/a'b",
    });
    expect(new URL(calls[1]!.url).searchParams.get('$filter')).toBe(
      "JoinWebUrl eq 'https://teams.microsoft.com/l/meetup-join/a''b'",
    );
    expect(found).toMatchObject({ id: 'M1', organizerId: 'org', organizerTenantId: 'ten' });
  });

  it('falls back to the unattributed transcript when speaker attribution is off', async () => {
    const { calls, fetchImpl } = recorder([
      tokenAnswer(),
      () =>
        json(403, {
          error: { code: 'Forbidden', innerError: { code: 'SpeakerAttributionNotAllowed' } },
        }),
      () => new Response('WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello', { status: 200 }),
    ]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
    expect(await graph.transcriptContent('U1', 'M1', 'T1')).toContain('Hello');
    const accepts = calls.slice(1).map((c) => new Headers(c.init.headers).get('accept'));
    expect(accepts).toEqual(['text/vtt', 'application/vnd.microsoft.graph.transcript+text']);
  });
});

describe('Graph client failures without an answer', () => {
  const timeout = () => {
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
  };
  const offline = () => {
    throw new TypeError('fetch failed');
  };

  it('a network error or a timeout of a Graph call is a GraphError(0)', async () => {
    for (const [fail, code] of [
      [offline, 'network'],
      [timeout, 'timeout'],
    ] as const) {
      const { fetchImpl } = recorder([tokenAnswer(), fail]);
      const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
      const error = await graph.listTranscripts('U1', 'M1').catch((e: unknown) => e);
      expect(error, code).toBeInstanceOf(GraphError);
      expect(error).toMatchObject({ status: 0, code });
    }
  });

  it('so is one of the token endpoint', async () => {
    for (const [fail, code] of [
      [offline, 'network'],
      [timeout, 'timeout'],
    ] as const) {
      const { fetchImpl } = recorder([fail]);
      const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
      const error = await graph.getUser('a').catch((e: unknown) => e);
      expect(error, code).toBeInstanceOf(GraphError);
      expect(error).toMatchObject({ status: 0, code });
    }
  });

  it('stops reading a transcript at the byte cap', async () => {
    let pulled = 0;
    const chunk = new TextEncoder().encode('x'.repeat(64 * 1024));
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += chunk.length;
        controller.enqueue(chunk);
      },
    });
    const { fetchImpl } = recorder([tokenAnswer(), () => new Response(endless, { status: 200 })]);
    const graph = createGraphClient({ config: secretConfig, fetch: fetchImpl });
    const text = await graph.transcriptContent('U1', 'M1', 'T1');
    expect(text.length).toBe(MAX_TRANSCRIPT_BYTES);
    expect(pulled).toBeLessThan(MAX_TRANSCRIPT_BYTES + 4 * chunk.length);
  });
});

describe('privateKeyFromPem', () => {
  const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;

  it('accepts an unencrypted RSA key (PKCS#8 or PKCS#1)', () => {
    for (const type of ['pkcs8', 'pkcs1'] as const) {
      const pem = rsa.export({ type, format: 'pem' }).toString();
      expect(privateKeyFromPem(pem).asymmetricKeyType, type).toBe('rsa');
    }
  });

  it('refuses an encrypted key, an EC key or none, clearly', () => {
    const encrypted = rsa
      .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' })
      .toString();
    const legacyEncrypted = rsa
      .export({ type: 'pkcs1', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' })
      .toString();
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString();
    expect(() => privateKeyFromPem(encrypted)).toThrow(/TEAMS_CERT_PATH.*unencrypted RSA/);
    expect(() => privateKeyFromPem(legacyEncrypted)).toThrow(/TEAMS_CERT_PATH.*unencrypted RSA/);
    expect(() => privateKeyFromPem(ec)).toThrow(/TEAMS_CERT_PATH.*unencrypted RSA/);
    expect(() =>
      privateKeyFromPem('-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----'),
    ).toThrow(/TEAMS_CERT_PATH/);
  });

  it('a bad key file stops the start, not the first Graph call', () => {
    const dir = mkdtempSync(join(tmpdir(), 'teams-key-'));
    const path = join(dir, 'teams.pem');
    writeFileSync(
      path,
      rsa
        .export({ type: 'pkcs8', format: 'pem', cipher: 'aes-256-cbc', passphrase: 'pw' })
        .toString(),
    );
    const config = {
      teams: {
        tenantId: TENANT,
        clientId: CLIENT_ID,
        credential: {
          kind: 'certificate' as const,
          keyPath: path,
          thumbprint: 'ABCDEF0123456789ABCDEF0123456789ABCDEF01',
        },
      },
    } as Parameters<typeof createTeams>[0];
    expect(() => createTeams(config)).toThrow(/TEAMS_CERT_PATH/);
    writeFileSync(path, rsa.export({ type: 'pkcs8', format: 'pem' }).toString());
    expect(createTeams(config)).not.toBeNull();
    expect(() =>
      createTeams({
        ...config,
        teams: {
          ...config.teams!,
          credential: { ...config.teams!.credential, keyPath: join(dir, 'missing.pem') },
        },
      } as Parameters<typeof createTeams>[0]),
    ).toThrow(/TEAMS_CERT_PATH/);
  });
});
