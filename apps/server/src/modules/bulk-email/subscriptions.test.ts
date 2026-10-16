import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { bulkCampaigns, bulkSubscriptions } from './schema.js';
import {
  applyProviderSuppressions,
  isSubscribed,
  setSubscribed,
  unsubscribedSql,
} from './subscriptions.js';

const audience = { groupIds: [], managerIds: [], roles: [], includeUserIds: [], excludeUserIds: [] };

describe('bulk email subscriptions', () => {
  const { db, close } = createDb(testDatabaseUrl);
  afterAll(() => close());

  async function newUser(): Promise<{ id: string; email: string }> {
    const id = randomUUID();
    const email = `${id}@example.com`;
    await db.insert(user).values({ id, name: 'Jana', email });
    return { id, email };
  }
  async function newCampaign(): Promise<string> {
    const id = randomUUID();
    await db.insert(bulkCampaigns).values({ id, name: 'News', audience });
    return id;
  }
  const row = async (userId: string) =>
    (await db.select().from(bulkSubscriptions).where(eq(bulkSubscriptions.userId, userId)))[0];

  it('a person without a row is subscribed', async () => {
    const { id } = await newUser();
    expect(await isSubscribed(db, id)).toBe(true);
  });

  it('unsubscribing stores the source, the campaign and the address', async () => {
    const { id, email } = await newUser();
    const campaignId = await newCampaign();
    expect(await setSubscribed(db, id, false, 'link', campaignId)).toBe('changed');
    expect(await row(id)).toMatchObject({ subscribed: false, source: 'link', campaignId, email });
    expect(await isSubscribed(db, id)).toBe(false);
  });

  it('unsubscribing twice is unchanged and keeps the first change', async () => {
    const { id } = await newUser();
    const campaignId = await newCampaign();
    await setSubscribed(db, id, false, 'link', campaignId);
    const first = await row(id);
    expect(await setSubscribed(db, id, false, 'one_click', null)).toBe('unchanged');
    expect(await row(id)).toEqual(first);
  });

  it('subscribing a person who never unsubscribed writes nothing', async () => {
    const { id } = await newUser();
    expect(await setSubscribed(db, id, true, 'profile', null)).toBe('unchanged');
    expect(await row(id)).toBeUndefined();
  });

  it('subscribing again flips the row with its source', async () => {
    const { id } = await newUser();
    await setSubscribed(db, id, false, 'link', await newCampaign());
    expect(await setSubscribed(db, id, true, 'profile', null)).toBe('changed');
    expect(await row(id)).toMatchObject({ subscribed: true, source: 'profile', campaignId: null });
    expect(await isSubscribed(db, id)).toBe(true);
  });

  it('a campaign id that is not a campaign (deleted) is stored as null', async () => {
    const { id } = await newUser();
    expect(await setSubscribed(db, id, false, 'link', randomUUID())).toBe('changed');
    expect(await row(id)).toMatchObject({ subscribed: false, campaignId: null });
  });

  it('an unknown user is unchanged', async () => {
    expect(await setSubscribed(db, randomUUID(), false, 'link', null)).toBe('unchanged');
  });

  it('unsubscribedSql matches only people who unsubscribed', async () => {
    const out = await newUser();
    const back = await newUser();
    const none = await newUser();
    await setSubscribed(db, out.id, false, 'link', null);
    await setSubscribed(db, back.id, false, 'link', null);
    await setSubscribed(db, back.id, true, 'profile', null);
    const ids = [out.id, back.id, none.id];
    const rows = await db
      .select({ id: user.id })
      .from(user)
      .where(sql`${user.id} in ${ids} and ${unsubscribedSql(user.id)}`);
    expect(rows.map((r) => r.id)).toEqual([out.id]);
  });

  describe('applyProviderSuppressions', () => {
    const hourAgo = () => new Date(Date.now() - 60 * 60 * 1000);

    it('unsubscribes matching Spolu users with source provider, case-insensitively', async () => {
      const a = await newUser();
      const date = hourAgo();
      const changed = await applyProviderSuppressions(db, [
        { email: a.email.toUpperCase(), date },
        { email: `${randomUUID()}@nobody.example`, date },
      ]);
      expect(changed).toBe(1);
      expect(await row(a.id)).toMatchObject({ subscribed: false, source: 'provider', changedAt: date });
    });

    it('never overrides a row changed in Spolu after the provider date', async () => {
      const a = await newUser();
      await setSubscribed(db, a.id, false, 'link', null);
      await setSubscribed(db, a.id, true, 'profile', null); // now: newer than the suppression
      expect(await applyProviderSuppressions(db, [{ email: a.email, date: hourAgo() }])).toBe(0);
      expect(await row(a.id)).toMatchObject({ subscribed: true, source: 'profile' });
    });

    it('overrides a subscribed row changed before the provider date', async () => {
      const a = await newUser();
      await setSubscribed(db, a.id, false, 'link', null);
      await setSubscribed(db, a.id, true, 'profile', null);
      const later = new Date(Date.now() + 60_000);
      expect(await applyProviderSuppressions(db, [{ email: a.email, date: later }])).toBe(1);
      expect(await row(a.id)).toMatchObject({ subscribed: false, source: 'provider' });
    });

    it('leaves a person who already unsubscribed in Spolu as they are', async () => {
      const a = await newUser();
      await setSubscribed(db, a.id, false, 'link', null);
      const before = await row(a.id);
      const later = new Date(Date.now() + 60_000);
      expect(await applyProviderSuppressions(db, [{ email: a.email, date: later }])).toBe(0);
      expect(await row(a.id)).toEqual(before);
    });

    it('one address listed twice (an unsubscribe and a complaint) is one change', async () => {
      const a = await newUser();
      const newer = hourAgo();
      const older = new Date(newer.getTime() - 60_000);
      const changed = await applyProviderSuppressions(db, [
        { email: a.email, date: older },
        { email: a.email, date: newer },
      ]);
      expect(changed).toBe(1);
      expect(await row(a.id)).toMatchObject({ subscribed: false, changedAt: newer });
    });

    it('an empty list does nothing', async () => {
      expect(await applyProviderSuppressions(db, [])).toBe(0);
    });
  });
});
