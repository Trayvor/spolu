import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';
import {
  weeklySummaries,
  weeklySummaryGroupSettings,
  weeklySummaryRecipients,
  weeklySummaryRevisions,
  weeklySummaryUnsubscribes,
} from './schema.js';
import { insertSummary, makeClient, makeGroup, sampleContent } from './test-fixtures.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

describe('weekly summary tables', () => {
  it('one row per group and week', async () => {
    const g = await makeGroup(db);
    await insertSummary(db, { groupId: g.id, week: '2026-W43' });
    await expect(insertSummary(db, { groupId: g.id, week: '2026-W43' })).rejects.toThrow();
    await insertSummary(db, { groupId: g.id, week: '2026-W44' });
  });

  it('status and week are checked', async () => {
    const g = await makeGroup(db);
    await expect(
      insertSummary(db, { groupId: g.id, week: '2026-W40', status: 'queued' as never }),
    ).rejects.toThrow();
    await expect(
      insertSummary(db, { groupId: g.id, week: '2026-W41', status: 'expired' as never }),
    ).rejects.toThrow();
    await expect(insertSummary(db, { groupId: g.id, week: '2026-43' })).rejects.toThrow();
  });

  it('window_end must be after window_start', async () => {
    const g = await makeGroup(db);
    const at = new Date();
    await expect(
      insertSummary(db, { groupId: g.id, week: '2026-W40', windowStart: at, windowEnd: at }),
    ).rejects.toThrow();
  });

  it('deleting a group deletes its summaries, settings and unsubscribes', async () => {
    const g = await makeGroup(db);
    const c = await makeClient(db, g.id);
    const id = await insertSummary(db, { groupId: g.id, week: '2026-W43' });
    await db.insert(weeklySummaryGroupSettings).values({ groupId: g.id, enabled: false });
    await db.insert(weeklySummaryUnsubscribes).values({ groupId: g.id, userId: c.id });
    await db.delete(groups).where(eq(groups.id, g.id));
    expect(await db.select().from(weeklySummaries).where(eq(weeklySummaries.id, id))).toEqual([]);
    expect(
      await db
        .select()
        .from(weeklySummaryGroupSettings)
        .where(eq(weeklySummaryGroupSettings.groupId, g.id)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(weeklySummaryUnsubscribes)
        .where(eq(weeklySummaryUnsubscribes.groupId, g.id)),
    ).toEqual([]);
  });

  it('deleting a user nulls updated_by and sent_by and deletes their recipient rows', async () => {
    const g = await makeGroup(db);
    const c = await makeClient(db, g.id);
    const id = await insertSummary(db, { groupId: g.id, week: '2026-W43', sentBy: c.id });
    await db.update(weeklySummaries).set({ updatedBy: c.id }).where(eq(weeklySummaries.id, id));
    await db
      .insert(weeklySummaryRecipients)
      .values({ summaryId: id, userId: c.id, name: c.name, email: c.email, language: 'sk' });
    await db.delete(user).where(eq(user.id, c.id));
    const [row] = await db.select().from(weeklySummaries).where(eq(weeklySummaries.id, id));
    expect(row).toMatchObject({ updatedBy: null, sentBy: null });
    expect(
      await db
        .select()
        .from(weeklySummaryRecipients)
        .where(eq(weeklySummaryRecipients.summaryId, id)),
    ).toEqual([]);
  });

  it("deleting a group deletes its summaries' revisions", async () => {
    const g = await makeGroup(db);
    const id = await insertSummary(db, { groupId: g.id, week: '2026-W43' });
    const revisionId = randomUUID();
    await db.insert(weeklySummaryRevisions).values({
      id: revisionId,
      summaryId: id,
      version: 1,
      content: sampleContent(),
      language: 'sk',
      source: 'facts',
    });
    await db.delete(groups).where(eq(groups.id, g.id));
    expect(
      await db
        .select()
        .from(weeklySummaryRevisions)
        .where(eq(weeklySummaryRevisions.id, revisionId)),
    ).toEqual([]);
  });
});
