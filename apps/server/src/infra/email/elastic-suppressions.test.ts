import { describe, expect, it } from 'vitest';
import { createElasticSuppressions } from './elastic-suppressions.js';

type Call = { url: string; init: RequestInit };

function fakeFetch(respond: (url: string) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return respond(url);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const header = (call: Call | undefined, name: string) =>
  (call?.init.headers as Record<string, string> | undefined)?.[name];

describe('elastic suppressions client', () => {
  it('lists a page of unsubscribes with the key, limit and offset', async () => {
    const { fetchImpl, calls } = fakeFetch(
      () =>
        new Response(
          JSON.stringify([
            { Email: 'Jana@Example.com', DateUpdated: '2026-10-15T08:00:00' },
            { Email: 'x@example.com', DateUpdated: 'nonsense' },
          ]),
          { status: 200 },
        ),
    );
    const client = createElasticSuppressions('secret-key', fetchImpl);
    const page = await client.list('unsubscribes', 2000, 1000);
    expect(calls[0]?.url).toBe(
      'https://api.elasticemail.com/v4/suppressions/unsubscribes?limit=1000&offset=2000',
    );
    expect(calls[0]?.init.method).toBe('GET');
    expect(header(calls[0], 'X-ElasticEmail-ApiKey')).toBe('secret-key');
    // A date without a zone is UTC; an unreadable date becomes the epoch (never newer than Spolu).
    expect(page).toEqual([
      { email: 'jana@example.com', date: new Date('2026-10-15T08:00:00Z') },
      { email: 'x@example.com', date: new Date(0) },
    ]);
  });

  it('lists complaints from their own endpoint', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('[]', { status: 200 }));
    await createElasticSuppressions('k', fetchImpl).list('complaints', 0, 1000);
    expect(calls[0]?.url).toBe(
      'https://api.elasticemail.com/v4/suppressions/complaints?limit=1000&offset=0',
    );
  });

  it('a failed list throws without the key', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('bad key secret-key', { status: 401 }));
    const error = await createElasticSuppressions('secret-key', fetchImpl)
      .list('unsubscribes', 0, 1000)
      .then(
        () => null,
        (e: unknown) => e as Error,
      );
    expect(error?.message).toContain('401');
    expect(error?.message).not.toContain('secret-key');
  });

  it('removes an address with DELETE /v4/suppressions/{email}, encoded', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response(null, { status: 204 }));
    await createElasticSuppressions('k', fetchImpl).remove('a+b@example.com');
    expect(calls[0]?.url).toBe('https://api.elasticemail.com/v4/suppressions/a%2Bb%40example.com');
    expect(calls[0]?.init.method).toBe('DELETE');
    expect(header(calls[0], 'X-ElasticEmail-ApiKey')).toBe('k');
  });

  it('removing an address that is not suppressed (404) is fine', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('not found', { status: 404 }));
    await expect(createElasticSuppressions('k', fetchImpl).remove('a@b.sk')).resolves.toBeUndefined();
  });

  it('a failed remove throws', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('oops', { status: 500 }));
    await expect(createElasticSuppressions('k', fetchImpl).remove('a@b.sk')).rejects.toThrow(/500/);
  });
});
