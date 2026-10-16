import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import type { Config } from '../../infra/config/config.js';
import type { JobOptions, JobQueue } from '../../infra/jobs/jobs.js';
import { user } from '../users/schema.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';
import {
  BULK_PROVIDER_RESUBSCRIBE_JOB,
  BULK_SYNC_SUPPRESSIONS_JOB,
  bulkEmailJobHandlers,
  bulkEmailSchedules,
  queueProviderResubscribe,
  syncSuppressions,
} from './jobs.js';
import { bulkSubscriptions } from './schema.js';
import { setSubscribed } from './subscriptions.js';

const elasticConfig = (unsubscribe: 'elastic' | 'spolu'): Config =>
  testConfig({
    bulkEmail: { driver: 'elastic', apiKey: 'secret-key', from: 'eGrant <i@egrant.sk>', unsubscribe },
  });

type Lists = { unsubscribes: unknown[]; complaints: unknown[] };

/** A fake Elastic: pages its lists by `limit`/`offset` and records every call. */
function fakeElastic(lists: Lists = { unsubscribes: [], complaints: [] }) {
  const calls: { url: string; method: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, method: init.method ?? 'GET' });
    const u = new URL(url);
    if (init.method === 'DELETE') return new Response(null, { status: 204 });
    const kind = u.pathname.split('/').pop() as keyof Lists;
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset'));
    return new Response(JSON.stringify(lists[kind].slice(offset, offset + limit)), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function recordingQueue() {
  const sent: { name: string; data: object; options?: JobOptions }[] = [];
  const queue: JobQueue = {
    send: async (name, data, options) => void sent.push({ name, data, options }),
  };
  return { queue, sent };
}

describe('bulk email jobs', () => {
  const { db, close } = createDb(testDatabaseUrl);
  afterAll(() => close());

  async function newUser(): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    const email = `${id}@example.com`;
    await db.insert(user).values({ id, name: 'Jana', email });
    return { id, email };
  }
  const row = async (userId: string) =>
    (await db.select().from(bulkSubscriptions).where(eq(bulkSubscriptions.userId, userId)))[0];

  describe('syncSuppressions', () => {
    it('pages through /v4/suppressions/unsubscribes and /complaints with limit 1000', async () => {
      const filler = Array.from({ length: 1000 }, (_, i) => ({
        Email: `nobody-${i}-${randomUUID()}@example.com`,
        DateUpdated: '2026-01-01T00:00:00',
      }));
      const { fetchImpl, calls } = fakeElastic({
        unsubscribes: [...filler, { Email: 'last@nobody.example', DateUpdated: '2026-01-01' }],
        complaints: [],
      });
      await syncSuppressions({ db, config: elasticConfig('elastic') }, fetchImpl);
      expect(calls.map((c) => c.url.replace('https://api.elasticemail.com/v4/suppressions/', ''))).toEqual([
        'unsubscribes?limit=1000&offset=0',
        'unsubscribes?limit=1000&offset=1000',
        'complaints?limit=1000&offset=0',
      ]);
    });

    it('sets provider unsubscribes for matching Spolu users', async () => {
      const a = await newUser();
      const b = await newUser();
      const { fetchImpl } = fakeElastic({
        unsubscribes: [{ Email: a.email.toUpperCase(), DateUpdated: '2026-10-01T10:00:00' }],
        complaints: [{ Email: b.email, DateUpdated: '2026-10-02T10:00:00' }],
      });
      const result = await syncSuppressions({ db, config: elasticConfig('elastic') }, fetchImpl);
      expect(result.changed).toBeGreaterThanOrEqual(2);
      expect(await row(a.id)).toMatchObject({ subscribed: false, source: 'provider' });
      expect(await row(b.id)).toMatchObject({ subscribed: false, source: 'provider' });
    });

    it("never overrides a row changed in Spolu after Elastic's DateUpdated", async () => {
      const a = await newUser();
      await setSubscribed(db, a.id, false, 'link', null);
      await setSubscribed(db, a.id, true, 'profile', null);
      const { fetchImpl } = fakeElastic({
        unsubscribes: [{ Email: a.email, DateUpdated: '2026-01-01T00:00:00' }],
        complaints: [],
      });
      await syncSuppressions({ db, config: elasticConfig('elastic') }, fetchImpl);
      expect(await row(a.id)).toMatchObject({ subscribed: true, source: 'profile' });
    });

    it('does nothing with the smtp driver', async () => {
      const { fetchImpl, calls } = fakeElastic();
      expect(await syncSuppressions({ db, config: testConfig() }, fetchImpl)).toEqual({
        checked: 0,
        changed: 0,
      });
      expect(calls).toEqual([]);
    });
  });

  it('the sync job runs syncSuppressions through its handler', async () => {
    const a = await newUser();
    const { fetchImpl } = fakeElastic({
      unsubscribes: [{ Email: a.email, DateUpdated: '2026-10-01T10:00:00' }],
      complaints: [],
    });
    const handlers = bulkEmailJobHandlers({ db, config: elasticConfig('spolu') }, fetchImpl);
    await handlers[BULK_SYNC_SUPPRESSIONS_JOB]!({});
    expect(await row(a.id)).toMatchObject({ subscribed: false, source: 'provider' });
  });

  it('the resubscribe job deletes the suppression of the address', async () => {
    const { fetchImpl, calls } = fakeElastic();
    const handlers = bulkEmailJobHandlers({ db, config: elasticConfig('elastic') }, fetchImpl);
    await handlers[BULK_PROVIDER_RESUBSCRIBE_JOB]!({ email: 'jana@example.com' });
    expect(calls).toEqual([
      { url: 'https://api.elasticemail.com/v4/suppressions/jana%40example.com', method: 'DELETE' },
    ]);
  });

  describe('queueProviderResubscribe', () => {
    it('queues the job in elastic unsubscribe mode, with two retries', async () => {
      const { queue, sent } = recordingQueue();
      await queueProviderResubscribe({ config: elasticConfig('elastic'), jobs: queue }, 'a@b.sk');
      expect(sent).toEqual([
        { name: BULK_PROVIDER_RESUBSCRIBE_JOB, data: { email: 'a@b.sk' }, options: { retryLimit: 2 } },
      ]);
    });

    it('queues nothing in spolu mode or with the smtp driver', async () => {
      const { queue, sent } = recordingQueue();
      await queueProviderResubscribe({ config: elasticConfig('spolu'), jobs: queue }, 'a@b.sk');
      await queueProviderResubscribe({ config: testConfig(), jobs: queue }, 'a@b.sk');
      expect(sent).toEqual([]);
    });
  });

  it('schedules the daily sync at 04:30 Bratislava only with the elastic driver', () => {
    expect(bulkEmailSchedules(testConfig())).toEqual([]);
    expect(bulkEmailSchedules(elasticConfig('spolu'))).toEqual([
      { name: BULK_SYNC_SUPPRESSIONS_JOB, cron: '30 4 * * *', tz: 'Europe/Bratislava' },
    ]);
  });
});
