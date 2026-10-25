import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { buildTestApp } from '../../../test/test-app.js';
import { createFakeBulkSender } from '../../infra/email/bulk.js';
import { signElasticWebhook } from '../../infra/email/elastic-webhook.js';
import { user } from '../users/schema.js';
import { bulkCampaigns, bulkEvents, bulkRecipients, bulkSubscriptions } from './schema.js';

const SECRET = 'whsec_route_test_secret';
const URL = '/api/bulk-email/webhook';
const audience = {
  groupIds: [],
  managerIds: [],
  roles: [],
  includeUserIds: [],
  excludeUserIds: [],
};

let ctx: Awaited<ReturnType<typeof buildTestApp>>;
beforeAll(async () => {
  ctx = await buildTestApp({
    config: {
      bulkEmail: {
        driver: 'elastic',
        apiKey: 'test-key',
        from: 'eGrant <news@example.com>',
        unsubscribe: 'elastic',
        webhookSecret: SECRET,
      },
    },
    bulkEmail: createFakeBulkSender(),
  });
});
afterAll(() => ctx.close());

// Every call comes from its own address, so the per-IP limit never trips other tests.
const ip = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function signed(
  body: string,
  opts: { target?: string; timestamp?: number; secret?: string; signature?: string } = {},
) {
  const target = opts.target ?? URL;
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const signature =
    opts.signature ??
    `v1=${signElasticWebhook(opts.secret ?? SECRET, timestamp, 'POST', target, body)}`;
  return ctx.app.inject({
    method: 'POST',
    url: target,
    remoteAddress: ip(),
    headers: {
      'content-type': 'application/json',
      'x-elasticemail-timestamp': String(timestamp),
      'x-elasticemail-signature': signature,
      'x-elasticemail-webhook-id': 'wh-1',
    },
    payload: body,
  });
}

async function newRecipient(): Promise<{ campaignId: string; userId: string }> {
  const userId = randomUUID();
  await ctx.deps.db
    .insert(user)
    .values({ id: userId, name: 'Jana', email: `${userId}@example.com` });
  const campaignId = randomUUID();
  await ctx.deps.db
    .insert(bulkCampaigns)
    .values({ id: campaignId, name: 'News', audience, status: 'sent' });
  await ctx.deps.db.insert(bulkRecipients).values({
    campaignId,
    userId,
    email: `${userId}@example.com`,
    name: 'Jana',
    language: 'sk',
    status: 'sent',
  });
  return { campaignId, userId };
}
const recipient = async (r: { campaignId: string; userId: string }) =>
  (
    await ctx.deps.db
      .select()
      .from(bulkRecipients)
      .where(and(eq(bulkRecipients.campaignId, r.campaignId), eq(bulkRecipients.userId, r.userId)))
  )[0]!;
const eventBody = (r: { campaignId: string; userId: string }, status: string, extra = {}) =>
  JSON.stringify({
    status,
    postback: `${r.campaignId}:${r.userId}`,
    messageid: `m-${randomUUID()}`,
    transaction: 't-1',
    date: '10/22/2026 10:00:00 AM',
    to: 'jana@example.com',
    ...extra,
  });

describe('POST /api/bulk-email/webhook', () => {
  it('a signed Opened event stamps the recipient', async () => {
    const r = await newRecipient();
    const res = await signed(eventBody(r, 'Opened'));
    expect(res.statusCode).toBe(200);
    expect((await recipient(r)).openedAt).toEqual(new Date('2026-10-22T10:00:00Z'));
  });

  it('the signature covers the query string exactly as received', async () => {
    const r = await newRecipient();
    const res = await signed(eventBody(r, 'Clicked'), { target: `${URL}?v=2` });
    expect(res.statusCode).toBe(200);
    expect((await recipient(r)).clickedAt).not.toBeNull();
  });

  it('a repeated event is answered 200 and stored once', async () => {
    const r = await newRecipient();
    const body = eventBody(r, 'Sent');
    expect((await signed(body)).statusCode).toBe(200);
    expect((await signed(body)).statusCode).toBe(200);
    const rows = await ctx.deps.db
      .select()
      .from(bulkEvents)
      .where(eq(bulkEvents.campaignId, r.campaignId));
    expect(rows).toHaveLength(1);
  });

  it('a complaint unsubscribes the person from bulk email', async () => {
    const r = await newRecipient();
    expect((await signed(eventBody(r, 'AbuseReport'))).statusCode).toBe(200);
    const [row] = await ctx.deps.db
      .select()
      .from(bulkSubscriptions)
      .where(eq(bulkSubscriptions.userId, r.userId));
    expect(row).toMatchObject({ subscribed: false, source: 'provider' });
  });

  it('the save-time test event and an unknown postback are answered 200 and ignored', async () => {
    const test = JSON.stringify({ status: 'opened', to: 'test@test.com', messageid: 'abc1234' });
    expect((await signed(test)).statusCode).toBe(200);
    const unknown = eventBody({ campaignId: randomUUID(), userId: randomUUID() }, 'Opened');
    expect((await signed(unknown)).statusCode).toBe(200);
  });

  it.each([
    ['a forged signature', { signature: `v1=${'0'.repeat(64)}` }],
    ['another secret', { secret: 'whsec_some_other_secret' }],
    ['a stale timestamp', { timestamp: Math.floor(Date.now() / 1000) - 301 }],
  ])('%s is 401 and stores nothing', async (_name, opts) => {
    const r = await newRecipient();
    const res = await signed(eventBody(r, 'Opened'), opts);
    expect(res.statusCode).toBe(401);
    expect((await recipient(r)).openedAt).toBeNull();
  });

  it('an unsigned request is 401', async () => {
    const r = await newRecipient();
    const res = await ctx.app.inject({
      method: 'POST',
      url: URL,
      remoteAddress: ip(),
      headers: { 'content-type': 'application/json' },
      payload: eventBody(r, 'Opened'),
    });
    expect(res.statusCode).toBe(401);
  });

  it('a signed body that is not JSON is 400', async () => {
    expect((await signed('not json')).statusCode).toBe(400);
  });

  it('a body over the limit is 413', async () => {
    const res = await signed(JSON.stringify({ status: 'Sent', pad: 'x'.repeat(70_000) }));
    expect(res.statusCode).toBe(413);
  });

  it('needs no session and passes the CSRF guard (a foreign Origin is still checked by signature)', async () => {
    const r = await newRecipient();
    const body = eventBody(r, 'Opened');
    const timestamp = Math.floor(Date.now() / 1000);
    const res = await ctx.app.inject({
      method: 'POST',
      url: URL,
      remoteAddress: ip(),
      headers: {
        'content-type': 'application/json',
        origin: 'https://elsewhere.example',
        'x-elasticemail-timestamp': String(timestamp),
        'x-elasticemail-signature': `v1=${signElasticWebhook(SECRET, timestamp, 'POST', URL, body)}`,
      },
      payload: body,
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('POST /api/bulk-email/webhook without ELASTIC_WEBHOOK_SECRET', () => {
  it('is 404: the route does not exist', async () => {
    const off = await buildTestApp();
    try {
      const res = await off.app.inject({
        method: 'POST',
        url: URL,
        headers: { 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(res.statusCode).toBe(404);
    } finally {
      await off.close();
    }
  });
});
