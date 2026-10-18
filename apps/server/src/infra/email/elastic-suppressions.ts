/** Elastic Email's suppression lists (v4 API, spec §5): read for the daily sync, lift on re-subscribe. */
const BASE = 'https://api.elasticemail.com/v4/suppressions';
const MAX_ERROR_TEXT = 300;

export type SuppressionList = 'unsubscribes' | 'complaints';
type Suppression = { email: string; date: Date };

export interface ElasticSuppressions {
  /** One page of a list, addresses in lower case. */
  list(kind: SuppressionList, offset: number, limit: number): Promise<Suppression[]>;
  /** Drops an address from every list; an address that is not listed is fine. */
  remove(email: string): Promise<void>;
}

/** Elastic's `DateUpdated` has no zone (UTC); an unreadable one becomes the epoch. */
function parseDate(value: unknown): Date {
  if (typeof value !== 'string') return new Date(0);
  const zoned = /(Z|[+-]\d\d:?\d\d)$/.test(value) ? value : `${value}Z`;
  const date = new Date(zoned);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

export function createElasticSuppressions(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 15_000,
): ElasticSuppressions {
  const clean = (text: string): string => text.split(apiKey).join('[key]').slice(0, MAX_ERROR_TEXT);
  const call = (url: string, method: 'GET' | 'DELETE') =>
    fetchImpl(url, {
      method,
      headers: { 'X-ElasticEmail-ApiKey': apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  const fail = async (what: string, res: Response): Promise<never> => {
    const text = await res.text().catch(() => '');
    throw new Error(`Elastic Email ${what} responded ${res.status}: ${clean(text)}`);
  };

  return {
    async list(kind, offset, limit) {
      const res = await call(`${BASE}/${kind}?limit=${limit}&offset=${offset}`, 'GET');
      if (!res.ok) return fail(`suppressions/${kind}`, res);
      const body = (await res.json().catch(() => null)) as unknown;
      if (!Array.isArray(body)) return [];
      return body.flatMap((item: { Email?: unknown; DateUpdated?: unknown }) =>
        typeof item?.Email === 'string'
          ? [{ email: item.Email.trim().toLowerCase(), date: parseDate(item.DateUpdated) }]
          : [],
      );
    },

    async remove(email) {
      const res = await call(`${BASE}/${encodeURIComponent(email)}`, 'DELETE');
      if (!res.ok && res.status !== 404) await fail('suppression delete', res);
    },
  };
}
