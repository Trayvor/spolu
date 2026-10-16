import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildTestApp } from '../../../test/test-app.js';
import { latestLoginCode } from '../../../test/mailpit.js';
import { loginAs, requestCode } from '../../../test/login.js';
import { createUnverifiedClient, setUserLanguage } from '../users/service.js';
import { bulkCampaigns, bulkSubscriptions } from './schema.js';
import { setSubscribed } from './subscriptions.js';
import { signUnsubscribeToken, TEST_CAMPAIGN_ID } from './token.js';

const audience = {
  groupIds: [],
  managerIds: [],
  roles: [],
  includeUserIds: [],
  excludeUserIds: [],
};

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  ctx = await buildTestApp();
});
afterAll(() => ctx.close());

async function newClient() {
  const email = `${randomUUID()}@example.com`;
  const row = await createUnverifiedClient(ctx.deps.db, email, 'Jana');
  return { id: row.id, email };
}
async function newCampaign(): Promise<string> {
  const id = randomUUID();
  await ctx.deps.db.insert(bulkCampaigns).values({ id, name: 'News', audience });
  return id;
}
const tokenFor = (userId: string, campaignId: string) =>
  signUnsubscribeToken(ctx.deps.config.appSecret, userId, campaignId);
const rowsOf = (userId: string) =>
  ctx.deps.db.select().from(bulkSubscriptions).where(eq(bulkSubscriptions.userId, userId));
// Every call comes from its own address, so the per-IP limit never trips other tests.
const ip = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const post = (url: string, extra: { headers?: Record<string, string>; payload?: string } = {}) =>
  ctx.app.inject({ method: 'POST', url, remoteAddress: ip(), ...extra });

describe('public unsubscribe routes', () => {
  it('GET answers the language, the setting and test false, nothing about the person', async () => {
    const person = await newClient();
    await setUserLanguage(ctx.deps.db, person.id, 'en');
    const res = await ctx.app.inject({
      method: 'GET',
      url: `/api/bulk-email/unsubscribe/${tokenFor(person.id, await newCampaign())}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ language: 'en', subscribed: true, test: false });
  });

  it('link unsubscribe stores subscribed false, source link and the campaign id', async () => {
    const person = await newClient();
    const campaignId = await newCampaign();
    const res = await post(`/api/bulk-email/unsubscribe/${tokenFor(person.id, campaignId)}`);
    expect(res.statusCode).toBe(204);
    expect(await rowsOf(person.id)).toMatchObject([
      { subscribed: false, source: 'link', campaignId, email: person.email },
    ]);
  });

  it('a second call is idempotent (204, one row)', async () => {
    const person = await newClient();
    const url = `/api/bulk-email/unsubscribe/${tokenFor(person.id, await newCampaign())}`;
    expect((await post(url)).statusCode).toBe(204);
    expect((await post(url)).statusCode).toBe(204);
    expect(await rowsOf(person.id)).toHaveLength(1);
  });

  it('one-click with body List-Unsubscribe=One-Click stores one_click', async () => {
    const person = await newClient();
    const res = await post(
      `/api/bulk-email/unsubscribe/${tokenFor(person.id, await newCampaign())}/one-click`,
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: 'List-Unsubscribe=One-Click',
      },
    );
    expect(res.statusCode).toBe(204);
    expect(await rowsOf(person.id)).toMatchObject([{ subscribed: false, source: 'one_click' }]);
  });

  it('one-click accepts any body', async () => {
    const person = await newClient();
    const res = await post(
      `/api/bulk-email/unsubscribe/${tokenFor(person.id, await newCampaign())}/one-click`,
      { headers: { 'content-type': 'multipart/form-data; boundary=x' }, payload: 'garbage' },
    );
    expect(res.statusCode).toBe(204);
    expect(await rowsOf(person.id)).toMatchObject([{ subscribed: false }]);
  });

  it('a cross-site POST (Sec-Fetch-Site: cross-site) to one-click is not blocked by the CSRF guard', async () => {
    const person = await newClient();
    const res = await post(
      `/api/bulk-email/unsubscribe/${tokenFor(person.id, await newCampaign())}/one-click`,
      {
        headers: {
          'sec-fetch-site': 'cross-site',
          origin: 'https://mail.example.com',
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: 'List-Unsubscribe=One-Click',
      },
    );
    expect(res.statusCode).toBe(204);
  });

  it('the CSRF guard still covers other bulk email routes', async () => {
    const res = await post('/api/bulk-email/campaigns', {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('subscribe again sets subscribed true', async () => {
    const person = await newClient();
    const token = tokenFor(person.id, await newCampaign());
    await post(`/api/bulk-email/unsubscribe/${token}`);
    const res = await post(`/api/bulk-email/subscribe/${token}`);
    expect(res.statusCode).toBe(204);
    expect(await rowsOf(person.id)).toMatchObject([{ subscribed: true }]);
    const info = await ctx.app.inject({
      method: 'GET',
      url: `/api/bulk-email/unsubscribe/${token}`,
    });
    expect(info.json()).toMatchObject({ subscribed: true });
  });

  it('a link of a deleted campaign still unsubscribes', async () => {
    const person = await newClient();
    const res = await post(`/api/bulk-email/unsubscribe/${tokenFor(person.id, randomUUID())}`);
    expect(res.statusCode).toBe(204);
    expect(await rowsOf(person.id)).toMatchObject([{ subscribed: false, campaignId: null }]);
  });

  it('a token with a changed user id answers 404 on every route and stores nothing', async () => {
    const person = await newClient();
    const other = await newClient();
    const campaignId = await newCampaign();
    const [, , sig] = tokenFor(person.id, campaignId).split('.');
    const forged = `${other.id}.${campaignId}.${sig}`;
    expect(
      (await ctx.app.inject({ method: 'GET', url: `/api/bulk-email/unsubscribe/${forged}` }))
        .statusCode,
    ).toBe(404);
    for (const url of [
      `/api/bulk-email/unsubscribe/${forged}`,
      `/api/bulk-email/unsubscribe/${forged}/one-click`,
      `/api/bulk-email/subscribe/${forged}`,
    ]) {
      expect((await post(url)).statusCode).toBe(404);
    }
    expect(await rowsOf(other.id)).toEqual([]);
  });

  it('a valid token of a deleted person answers 404', async () => {
    const res = await post(`/api/bulk-email/unsubscribe/${tokenFor(randomUUID(), randomUUID())}`);
    expect(res.statusCode).toBe(404);
  });

  it('a test token answers test true and changes nothing', async () => {
    const person = await newClient();
    const token = tokenFor(person.id, TEST_CAMPAIGN_ID);
    const info = await ctx.app.inject({
      method: 'GET',
      url: `/api/bulk-email/unsubscribe/${token}`,
    });
    expect(info.json()).toMatchObject({ test: true, subscribed: true });
    expect((await post(`/api/bulk-email/unsubscribe/${token}`)).statusCode).toBe(204);
    expect((await post(`/api/bulk-email/unsubscribe/${token}/one-click`)).statusCode).toBe(204);
    expect(await rowsOf(person.id)).toEqual([]);
  });

  it('the 31st call a minute from one IP answers 429', async () => {
    const person = await newClient();
    const url = `/api/bulk-email/unsubscribe/${tokenFor(person.id, await newCampaign())}`;
    const remoteAddress = '192.0.2.31';
    for (let i = 0; i < 30; i++) {
      const res = await ctx.app.inject({ method: i % 2 ? 'GET' : 'POST', url, remoteAddress });
      expect(res.statusCode).not.toBe(429);
    }
    const res = await ctx.app.inject({ method: 'POST', url, remoteAddress });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });

  it('a login code still reaches an unsubscribed person (P5)', async () => {
    const person = await newClient();
    await setSubscribed(ctx.deps.db, person.id, false, 'link', null);
    expect((await requestCode(ctx.app, person.email)).statusCode).toBe(200);
    expect(await latestLoginCode(person.email)).toMatch(/^\d{6}$/);
  });
});

describe('re-subscribing and Elastic', () => {
  async function appWith(unsubscribe: 'elastic' | 'spolu') {
    const deletes: string[] = [];
    const bulkFetch = (async (url: string, init: RequestInit) => {
      if (init.method === 'DELETE') deletes.push(decodeURIComponent(url.split('/').pop()!));
      return new Response(null, { status: 204 });
    }) as unknown as typeof fetch;
    const app = await buildTestApp({
      config: {
        bulkEmail: { driver: 'elastic', apiKey: 'k', from: 'eGrant <i@egrant.sk>', unsubscribe },
      },
      bulkFetch,
    });
    return { ...app, deletes };
  }

  it('re-subscribing in elastic mode asks Elastic to drop the suppression; in spolu mode it does not', async () => {
    for (const mode of ['elastic', 'spolu'] as const) {
      const test = await appWith(mode);
      try {
        const person = await newClient();
        const token = signUnsubscribeToken(test.deps.config.appSecret, person.id, randomUUID());
        await test.app.inject({ method: 'POST', url: `/api/bulk-email/unsubscribe/${token}` });
        expect(test.deletes).toEqual([]);
        await test.app.inject({ method: 'POST', url: `/api/bulk-email/subscribe/${token}` });
        expect(test.deletes).toEqual(mode === 'elastic' ? [person.email] : []);
      } finally {
        await test.close();
      }
    }
  });

  it('a failing Elastic call does not fail the re-subscribe', async () => {
    const test = await buildTestApp({
      config: {
        bulkEmail: {
          driver: 'elastic',
          apiKey: 'k',
          from: 'eGrant <i@egrant.sk>',
          unsubscribe: 'elastic',
        },
      },
      bulkFetch: (async () => new Response('down', { status: 503 })) as unknown as typeof fetch,
    });
    try {
      const person = await newClient();
      const token = signUnsubscribeToken(test.deps.config.appSecret, person.id, randomUUID());
      await test.app.inject({ method: 'POST', url: `/api/bulk-email/unsubscribe/${token}` });
      const res = await test.app.inject({
        method: 'POST',
        url: `/api/bulk-email/subscribe/${token}`,
      });
      expect(res.statusCode).toBe(204);
      expect(await rowsOf(person.id)).toMatchObject([{ subscribed: true }]);
    } finally {
      await test.close();
    }
  });
});

describe('profile setting', () => {
  it('GET /api/me/bulk-email is true with no row', async () => {
    const person = await newClient();
    const cookie = await loginAs(ctx.app, person.email);
    const res = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/bulk-email',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ subscribed: true });
  });

  it('PUT false then true flips it with source profile', async () => {
    const person = await newClient();
    const cookie = await loginAs(ctx.app, person.email);
    const put = (subscribed: boolean) =>
      ctx.app.inject({
        method: 'PUT',
        url: '/api/me/bulk-email',
        headers: { cookie },
        payload: { subscribed },
      });
    expect((await put(false)).statusCode).toBe(204);
    expect(await rowsOf(person.id)).toMatchObject([{ subscribed: false, source: 'profile' }]);
    const off = await ctx.app.inject({
      method: 'GET',
      url: '/api/me/bulk-email',
      headers: { cookie },
    });
    expect(off.json()).toEqual({ subscribed: false });
    expect((await put(true)).statusCode).toBe(204);
    expect(await rowsOf(person.id)).toMatchObject([{ subscribed: true, source: 'profile' }]);
  });

  it('PUT with a wrong body answers 400', async () => {
    const person = await newClient();
    const cookie = await loginAs(ctx.app, person.email);
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/me/bulk-email',
      headers: { cookie },
      payload: { subscribed: 'no' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('GET and PUT without a session answer 401', async () => {
    expect((await ctx.app.inject({ method: 'GET', url: '/api/me/bulk-email' })).statusCode).toBe(
      401,
    );
    const res = await ctx.app.inject({
      method: 'PUT',
      url: '/api/me/bulk-email',
      payload: { subscribed: false },
    });
    expect(res.statusCode).toBe(401);
  });
});
