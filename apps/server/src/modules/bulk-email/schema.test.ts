import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { user } from '../users/schema.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { bulkCampaigns, bulkRecipients, bulkSubscriptions } from './schema.js';

const audience = {
  groupIds: [],
  managerIds: [],
  roles: [],
  includeUserIds: [],
  excludeUserIds: [],
};

describe('bulk email tables', () => {
  const { db, close } = createDb(testDatabaseUrl);
  afterAll(() => close());

  async function newUser(): Promise<string> {
    const id = randomUUID();
    await db.insert(user).values({ id, name: 'Jana', email: `${id}@example.com` });
    return id;
  }

  it('a new campaign is a draft, version 1, without blocks', async () => {
    const id = randomUUID();
    await db.insert(bulkCampaigns).values({ id, name: 'News', audience });
    const [row] = await db.select().from(bulkCampaigns).where(eq(bulkCampaigns.id, id));
    expect(row).toMatchObject({ status: 'draft', version: 1, blocks: [], subject: '' });
  });

  it('rejects an unknown campaign status and recipient status', async () => {
    const id = randomUUID();
    await expect(
      db.insert(bulkCampaigns).values({ id, name: 'N', audience, status: 'paused' as never }),
    ).rejects.toThrow();
    await db.insert(bulkCampaigns).values({ id, name: 'N', audience });
    const userId = await newUser();
    const row = { campaignId: id, userId, email: 'a@b.sk', name: 'A', language: 'sk' as const };
    await expect(
      db.insert(bulkRecipients).values({ ...row, status: 'opened' as never }),
    ).rejects.toThrow();
    await db.insert(bulkRecipients).values(row);
    const [inserted] = await db
      .select()
      .from(bulkRecipients)
      .where(eq(bulkRecipients.campaignId, id));
    expect(inserted).toMatchObject({ status: 'queued', attempts: 0, error: null });
  });

  it('a deleted campaign keeps the subscription row with campaign_id null', async () => {
    const id = randomUUID();
    await db.insert(bulkCampaigns).values({ id, name: 'N', audience });
    const userId = await newUser();
    await db.insert(bulkSubscriptions).values({
      userId,
      subscribed: false,
      email: 'a@b.sk',
      campaignId: id,
      source: 'link',
      changedAt: new Date(),
    });
    await db.delete(bulkCampaigns).where(eq(bulkCampaigns.id, id));
    const [row] = await db
      .select()
      .from(bulkSubscriptions)
      .where(eq(bulkSubscriptions.userId, userId));
    expect(row).toMatchObject({ subscribed: false, campaignId: null, source: 'link' });
  });
});
