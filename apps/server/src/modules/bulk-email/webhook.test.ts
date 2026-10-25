import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { bulkCampaigns, bulkEvents, bulkRecipients, bulkSubscriptions } from './schema.js';
import { setSubscribed } from './subscriptions.js';
import { parseElasticEvent, parseElasticDate, recordBulkEvent } from './webhook.js';

const audience = {
  groupIds: [],
  managerIds: [],
  roles: [],
  includeUserIds: [],
  excludeUserIds: [],
};
const NOW = new Date('2026-10-22T12:00:00Z');

describe('parseElasticEvent', () => {
  const base = {
    status: 'Opened',
    postback: 'c1:u1',
    messageid: 'm-1',
    transaction: 't-1',
    date: '10/22/2026 11:59:00 AM',
    to: 'jana@example.com',
  };

  it.each([
    ['Sent', 'delivered'],
    ['Opened', 'opened'],
    ['Clicked', 'clicked'],
    ['Error', 'bounced'],
    ['AbuseReport', 'complaint'],
    ['Unsubscribed', 'unsubscribed'],
  ])('maps %s to %s', (status, kind) => {
    const event = parseElasticEvent({ ...base, status }, NOW);
    expect(event).toMatchObject({ kind, campaignId: 'c1', userId: 'u1' });
  });

  it('reads the date as UTC', () => {
    expect(parseElasticEvent(base, NOW)).toMatchObject({
      occurredAt: new Date('2026-10-22T11:59:00Z'),
    });
  });

  it('the key is the same for a repeat and differs per status and date', () => {
    const a = parseElasticEvent(base, NOW);
    const b = parseElasticEvent({ ...base }, NOW);
    const c = parseElasticEvent({ ...base, status: 'Clicked' }, NOW);
    const d = parseElasticEvent({ ...base, date: '10/22/2026 11:59:01 AM' }, NOW);
    expect(a && b && c && d).toBeTruthy();
    expect(a!.key).toBe(b!.key);
    expect(new Set([a!.key, c!.key, d!.key]).size).toBe(3);
    expect(a!.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('keeps a bounce category, short', () => {
    expect(
      parseElasticEvent({ ...base, status: 'Error', category: 'NoMailbox' }, NOW),
    ).toMatchObject({ kind: 'bounced', category: 'NoMailbox', hardBounce: true });
    expect(
      parseElasticEvent({ ...base, status: 'Error', category: 'Throttled' }, NOW),
    ).toMatchObject({ hardBounce: false });
    expect(
      parseElasticEvent({ ...base, status: 'Error', category: 'x'.repeat(200) }, NOW)!.category,
    ).toHaveLength(50);
  });

  it.each([
    ['the save-time test event (lowercase status)', { status: 'opened' }],
    ['an unknown status', { status: 'Delivered' }],
    ['no postback', { postback: null }],
    ['a test send postback (test:campaign:user)', { postback: 'test:c1:u1' }],
    ['an empty postback part', { postback: 'c1:' }],
    ['a postback that is not text', { postback: 42 }],
  ])('ignores %s', (_name, over) => {
    expect(parseElasticEvent({ ...base, ...over }, NOW)).toBeNull();
  });

  it('ignores a body that is not an object', () => {
    expect(parseElasticEvent(null, NOW)).toBeNull();
    expect(parseElasticEvent(['Sent'], NOW)).toBeNull();
    expect(parseElasticEvent('Sent', NOW)).toBeNull();
  });
});

describe('parseElasticDate', () => {
  it.each([
    ['3/10/2012 10:20:30 AM', '2012-03-10T10:20:30Z'],
    ['3/10/2012 12:05:00 AM', '2012-03-10T00:05:00Z'],
    ['3/10/2012 12:05:00 PM', '2012-03-10T12:05:00Z'],
    ['3/10/2012 1:05:00 PM', '2012-03-10T13:05:00Z'],
    ['2026-10-22T10:00:00', '2026-10-22T10:00:00Z'],
    ['2026-10-22T10:00:00Z', '2026-10-22T10:00:00Z'],
    ['2026-10-22T12:00:00+02:00', '2026-10-22T10:00:00Z'],
  ])('reads %s', (text, iso) => {
    expect(parseElasticDate(text, NOW)).toEqual(new Date(iso));
  });

  it('an unreadable, missing or future date becomes the time received', () => {
    expect(parseElasticDate('yesterday', NOW)).toEqual(NOW);
    expect(parseElasticDate(undefined, NOW)).toEqual(NOW);
    expect(parseElasticDate('2027-01-01T00:00:00Z', NOW)).toEqual(NOW);
  });
});

describe('recordBulkEvent', () => {
  const { db, close } = createDb(testDatabaseUrl);
  afterAll(() => close());

  async function newRecipient(): Promise<{ campaignId: string; userId: string; email: string }> {
    const userId = randomUUID();
    const email = `${userId}@example.com`;
    await db.insert(user).values({ id: userId, name: 'Jana', email });
    const campaignId = randomUUID();
    await db
      .insert(bulkCampaigns)
      .values({ id: campaignId, name: 'News', audience, status: 'sent' });
    await db.insert(bulkRecipients).values({
      campaignId,
      userId,
      email,
      name: 'Jana',
      language: 'sk',
      status: 'sent',
    });
    return { campaignId, userId, email };
  }
  const event = (
    r: { campaignId: string; userId: string },
    status: string,
    date: string,
    extra: Record<string, unknown> = {},
  ) =>
    parseElasticEvent(
      { status, postback: `${r.campaignId}:${r.userId}`, messageid: 'm', date, ...extra },
      NOW,
    )!;
  const recipient = async (r: { campaignId: string; userId: string }) =>
    (
      await db
        .select()
        .from(bulkRecipients)
        .where(
          and(eq(bulkRecipients.campaignId, r.campaignId), eq(bulkRecipients.userId, r.userId)),
        )
    )[0]!;
  const subscription = async (userId: string) =>
    (await db.select().from(bulkSubscriptions).where(eq(bulkSubscriptions.userId, userId)))[0];
  const events = (campaignId: string) =>
    db.select().from(bulkEvents).where(eq(bulkEvents.campaignId, campaignId));

  it('an unknown recipient is "unknown" and stores nothing', async () => {
    const r = { campaignId: randomUUID(), userId: randomUUID() };
    expect(await recordBulkEvent(db, event(r, 'Opened', '2026-10-22T10:00:00Z'))).toBe('unknown');
    expect(await events(r.campaignId)).toHaveLength(0);
  });

  it('stores the event once and stamps the first time on the recipient', async () => {
    const r = await newRecipient();
    const later = event(r, 'Opened', '2026-10-22T11:00:00Z');
    expect(await recordBulkEvent(db, later)).toBe('recorded');
    expect(await recordBulkEvent(db, later)).toBe('duplicate');
    expect(await recordBulkEvent(db, event(r, 'Opened', '2026-10-22T10:00:00Z'))).toBe('recorded');
    expect(await events(r.campaignId)).toHaveLength(2);
    const row = await recipient(r);
    expect(row.openedAt).toEqual(new Date('2026-10-22T10:00:00Z'));
    expect(row.clickedAt).toBeNull();
    expect(await subscription(r.userId)).toBeUndefined();
  });

  it.each([
    ['Sent', 'deliveredAt'],
    ['Clicked', 'clickedAt'],
    ['Error', 'bouncedAt'],
    ['AbuseReport', 'complainedAt'],
  ] as const)('%s stamps %s', async (status, column) => {
    const r = await newRecipient();
    await recordBulkEvent(db, event(r, status, '2026-10-22T10:00:00Z'));
    expect((await recipient(r))[column]).toEqual(new Date('2026-10-22T10:00:00Z'));
  });

  it.each([
    ['a complaint', 'AbuseReport', {}],
    ['a hard bounce', 'Error', { category: 'NoMailbox' }],
    ['an unsubscribe', 'Unsubscribed', {}],
  ])('%s unsubscribes the person from bulk email (source provider)', async (_n, status, extra) => {
    const r = await newRecipient();
    await recordBulkEvent(db, event(r, status, '2026-10-22T10:00:00Z', extra));
    expect(await subscription(r.userId)).toMatchObject({
      subscribed: false,
      source: 'provider',
      email: r.email,
      changedAt: new Date('2026-10-22T10:00:00Z'),
    });
  });

  it('a soft bounce does not unsubscribe', async () => {
    const r = await newRecipient();
    await recordBulkEvent(db, event(r, 'Error', '2026-10-22T10:00:00Z', { category: 'Throttled' }));
    expect(await subscription(r.userId)).toBeUndefined();
  });

  it('a re-subscribe in Spolu after the complaint wins over a late event', async () => {
    const r = await newRecipient();
    await setSubscribed(db, r.userId, false, 'profile', null);
    await setSubscribed(db, r.userId, true, 'profile', null);
    await recordBulkEvent(db, event(r, 'AbuseReport', '2026-01-01T10:00:00Z'));
    expect(await subscription(r.userId)).toMatchObject({ subscribed: true, source: 'profile' });
  });
});
