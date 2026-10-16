import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import {
  BulkAudienceSchema,
  type BulkBlock,
  type BulkCampaignDraft,
  type BulkRecipientStatus,
  type SessionUser,
} from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { bulkCampaigns, bulkRecipients, bulkSubscriptions } from './schema.js';
import {
  CampaignChangedError,
  CampaignNotFoundError,
  createCampaign,
  deleteDraft,
  duplicateCampaign,
  getCampaign,
  InvalidCursorError,
  listCampaigns,
  NotDraftError,
  saveDraft,
} from './service.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
beforeAll(() => counting.db.execute(sql`select 1`));
afterAll(async () => {
  await close();
  await counting.close();
});

async function newAdmin(name = 'Ada', language: 'sk' | 'en' = 'sk'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const admin = await addAdmin(db, { email, name });
  await db.update(user).set({ language }).where(eq(user.id, admin.id));
  return { id: admin.id, email, name, role: 'admin' };
}

async function newClient(): Promise<string> {
  const id = randomUUID();
  await db
    .insert(user)
    .values({ id, email: `${id}@example.com`, name: 'Cleo', role: 'client', emailVerified: true });
  return id;
}

const blocks: BulkBlock[] = [
  { id: 'b1', type: 'heading', text: 'Hello {{name}}', align: 'left' },
  { id: 'b2', type: 'button', label: 'Open', url: 'https://egrant.sk', align: 'center' },
];

const draft = (over: Partial<BulkCampaignDraft> = {}): BulkCampaignDraft => ({
  name: 'October news',
  subject: 'News',
  preheader: 'What is new',
  blocks,
  audience: BulkAudienceSchema.parse({ roles: ['client'], groupIds: ['g1'] }),
  version: 1,
  ...over,
});

const setStatus = (id: string, status: 'sending' | 'sent' | 'cancelled') =>
  db.update(bulkCampaigns).set({ status }).where(eq(bulkCampaigns.id, id));

describe('campaigns', () => {
  it('creates a draft with an empty audience, no blocks and version 1', async () => {
    const admin = await newAdmin('Creator');
    const c = await createCampaign(db, admin, 'First');
    expect(c).toMatchObject({
      name: 'First',
      subject: '',
      preheader: '',
      blocks: [],
      audience: { groupIds: [], managerIds: [], roles: [], includeUserIds: [], excludeUserIds: [] },
      status: 'draft',
      version: 1,
      sender: null,
      recipientCount: null,
      createdBy: admin.id,
      createdByName: 'Creator',
      sentBy: null,
      sentByName: null,
      sendStartedAt: null,
      finishedAt: null,
      counts: {
        queued: 0,
        sending: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        cancelled: 0,
        unsubscribed: 0,
      },
    });
    expect(new Date(c.createdAt).toISOString()).toBe(c.createdAt);
    expect(await getCampaign(db, c.id)).toEqual(c);
  });

  it('getCampaign of an unknown id is null', async () => {
    expect(await getCampaign(db, randomUUID())).toBeNull();
  });

  it('saves a draft and bumps the version', async () => {
    const admin = await newAdmin();
    const other = await newAdmin();
    const c = await createCampaign(db, admin, 'Draft');
    const saved = await saveDraft(db, other, c.id, draft());
    expect(saved).toMatchObject({
      name: 'October news',
      subject: 'News',
      preheader: 'What is new',
      blocks,
      audience: draft().audience,
      version: 2,
      updatedBy: other.id,
    });
    expect(saved.updatedAt >= c.updatedAt).toBe(true);
  });

  it('save with an old version → CampaignChangedError (two admins)', async () => {
    const a = await newAdmin();
    const b = await newAdmin();
    const c = await createCampaign(db, a, 'Shared');
    await saveDraft(db, a, c.id, draft({ name: 'By A' }));
    await expect(saveDraft(db, b, c.id, draft({ name: 'By B' }))).rejects.toBeInstanceOf(
      CampaignChangedError,
    );
    expect((await getCampaign(db, c.id))!.name).toBe('By A');
  });

  it('save of a sending campaign → NotDraftError', async () => {
    const admin = await newAdmin();
    const c = await createCampaign(db, admin, 'Going');
    await setStatus(c.id, 'sending');
    await expect(saveDraft(db, admin, c.id, draft())).rejects.toBeInstanceOf(NotDraftError);
    // Not draft wins over a stale version.
    await expect(saveDraft(db, admin, c.id, draft({ version: 7 }))).rejects.toBeInstanceOf(
      NotDraftError,
    );
  });

  it('save of an unknown campaign → CampaignNotFoundError', async () => {
    const admin = await newAdmin();
    await expect(saveDraft(db, admin, randomUUID(), draft())).rejects.toBeInstanceOf(
      CampaignNotFoundError,
    );
  });

  it('deletes a draft, but not a sent campaign', async () => {
    const admin = await newAdmin();
    const d = await createCampaign(db, admin, 'Gone');
    await deleteDraft(db, d.id);
    expect(await getCampaign(db, d.id)).toBeNull();

    const s = await createCampaign(db, admin, 'Sent');
    await setStatus(s.id, 'sent');
    await expect(deleteDraft(db, s.id)).rejects.toBeInstanceOf(NotDraftError);
    await expect(deleteDraft(db, randomUUID())).rejects.toBeInstanceOf(CampaignNotFoundError);
  });

  it('duplicate of a sent campaign is a draft with the same blocks and audience, version 1', async () => {
    const author = await newAdmin('Author');
    const sk = await newAdmin('Slovak', 'sk');
    const en = await newAdmin('English', 'en');
    const c = await createCampaign(db, author, 'Newsletter');
    await saveDraft(db, author, c.id, draft({ name: 'Newsletter' }));
    await db
      .update(bulkCampaigns)
      .set({ status: 'sent', sender: 'x@example.com', recipientCount: 3, sentBy: author.id })
      .where(eq(bulkCampaigns.id, c.id));

    const copy = await duplicateCampaign(db, sk, c.id);
    expect(copy).toMatchObject({
      name: 'Newsletter (kópia)',
      subject: 'News',
      preheader: 'What is new',
      blocks,
      audience: draft().audience,
      status: 'draft',
      version: 1,
      sender: null,
      recipientCount: null,
      sentBy: null,
      createdBy: sk.id,
      createdByName: 'Slovak',
    });
    expect(copy.id).not.toBe(c.id);
    expect((await duplicateCampaign(db, en, c.id)).name).toBe('Newsletter (copy)');
  });

  it('duplicate keeps the name within its limit', async () => {
    const admin = await newAdmin('Long', 'en');
    const c = await createCampaign(db, admin, 'x'.repeat(200));
    const copy = await duplicateCampaign(db, admin, c.id);
    expect(copy.name).toBe(`${'x'.repeat(193)} (copy)`);
    await expect(duplicateCampaign(db, admin, randomUUID())).rejects.toBeInstanceOf(
      CampaignNotFoundError,
    );
  });

  it('counts recipients by status and people unsubscribed through the campaign', async () => {
    const admin = await newAdmin();
    const c = await createCampaign(db, admin, 'Counted');
    const statuses: BulkRecipientStatus[] = ['queued', 'sent', 'sent', 'failed', 'skipped'];
    const ids: string[] = [];
    for (const status of statuses) {
      const userId = await newClient();
      ids.push(userId);
      await db.insert(bulkRecipients).values({
        campaignId: c.id,
        userId,
        email: 'a@example.com',
        name: 'A',
        language: 'sk',
        status,
      });
    }
    await db.insert(bulkSubscriptions).values([
      {
        userId: ids[1]!,
        subscribed: false,
        email: 'a',
        campaignId: c.id,
        source: 'link',
        changedAt: new Date(),
      },
      {
        userId: ids[2]!,
        subscribed: true,
        email: 'b',
        campaignId: c.id,
        source: 'link',
        changedAt: new Date(),
      },
    ]);
    const expected = {
      queued: 1,
      sending: 0,
      sent: 2,
      failed: 1,
      skipped: 1,
      cancelled: 0,
      unsubscribed: 1,
    };
    expect((await getCampaign(db, c.id))!.counts).toEqual(expected);

    let found;
    let cursor: string | undefined;
    do {
      const page = await listCampaigns(db, cursor);
      found = page.items.find((item) => item.id === c.id);
      cursor = page.nextCursor ?? undefined;
    } while (!found && cursor);
    expect(found!.counts).toEqual(expected);
  });

  it('list is newest first, 50 per page with a cursor, in one query a page', async () => {
    const admin = await newAdmin('Lister');
    const mine: string[] = [];
    for (let i = 0; i < 51; i++) mine.push((await createCampaign(db, admin, `L${i}`)).id);
    const newestFirst = [...mine].reverse();

    const seen: string[] = [];
    let cursor: string | undefined;
    let first = true;
    do {
      counting.reset();
      const page = await listCampaigns(counting.db, cursor);
      expect(counting.count()).toBe(1);
      if (first) expect(page.items).toHaveLength(50);
      first = false;
      for (const item of page.items) {
        if (mine.includes(item.id)) seen.push(item.id);
        expect(item).not.toHaveProperty('blocks');
      }
      cursor = page.nextCursor ?? undefined;
    } while (seen.length < mine.length && cursor);
    expect(seen).toEqual(newestFirst);
  });

  it('a malformed cursor is rejected', async () => {
    await expect(listCampaigns(db, 'nope')).rejects.toBeInstanceOf(InvalidCursorError);
  });
});
