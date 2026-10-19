import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { countEmailsTo, latestEmail } from '../../../test/mail.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { addManager } from '../groups/managers.js';
import { purgeRecipientEmails, remindManagers } from './jobs.js';
import {
  weeklySummaries,
  weeklySummaryAdminPrefs,
  weeklySummaryRecipients,
  weeklySummaryRevisions,
} from './schema.js';
import { setRemind } from './service.js';
import { weeklyHarness } from './test-harness.js';
import {
  insertSummary,
  makeClient,
  makeGroup,
  makeManager,
  sampleContent,
} from './test-fixtures.js';
import { isoWeek } from './week.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const DAY = 86_400_000;

describe('the manager reminder and the purge', () => {
  it("the reminder emails each manager once a week with their groups' drafts", async () => {
    const a = await makeGroup(db, 'Alfa');
    const manager = await makeManager(db, a.id);
    const b = await makeGroup(db, 'Beta');
    const c = await makeGroup(db, 'Gama');
    await addManager(db, b.id, manager.id);
    await addManager(db, c.id, manager.id);
    const week = isoWeek(new Date());
    await insertSummary(db, { groupId: a.id, week });
    await insertSummary(db, { groupId: b.id, week });
    await insertSummary(db, { groupId: c.id, week, status: 'sent' });
    const { deps } = weeklyHarness(db);
    const scope = { groupIds: [a.id, b.id, c.id] };
    expect(await remindManagers(deps, new Date(), scope)).toBe(1);
    const mail = await latestEmail(manager.email);
    expect(mail.subject).toBe(serverTexts('sk').weeklySummary.reminder.subject(2));
    expect(mail.text).toContain('Alfa, Beta');
    expect(await remindManagers(deps, new Date(), scope)).toBe(0);
    expect(await countEmailsTo(manager.email)).toBe(1);
  });

  it('a manager who turned reminders off gets none; a manager with no draft gets none', async () => {
    const g = await makeGroup(db);
    const off = await makeManager(db, g.id);
    await setRemind(db, off.id, false);
    await insertSummary(db, { groupId: g.id, week: isoWeek(new Date()) });
    const idle = await makeGroup(db);
    const idleManager = await makeManager(db, idle.id);
    const { deps } = weeklyHarness(db);
    expect(await remindManagers(deps, new Date(), { groupIds: [g.id, idle.id] })).toBe(0);
    expect(await countEmailsTo(off.email)).toBe(0);
    expect(await countEmailsTo(idleManager.email)).toBe(0);
    await db.delete(weeklySummaryAdminPrefs).where(eq(weeklySummaryAdminPrefs.userId, off.id));
  });

  it('purge blanks recipient emails older than 90 days and keeps the rows', async () => {
    const g = await makeGroup(db);
    const client = await makeClient(db, g.id, { name: 'Stará Adresa', language: 'it' });
    const fresh = await makeClient(db, g.id);
    const id = await insertSummary(db, { groupId: g.id, week: '2026-W01', status: 'sent' });
    const old = new Date(Date.now() - 100 * DAY);
    await db.insert(weeklySummaryRecipients).values([
      {
        summaryId: id,
        userId: client.id,
        name: client.name,
        email: client.email,
        language: 'it',
        status: 'sent',
        sentAt: old,
      },
      {
        summaryId: id,
        userId: fresh.id,
        name: fresh.name,
        email: fresh.email,
        language: 'sk',
        status: 'sent',
        sentAt: new Date(),
      },
    ]);
    await purgeRecipientEmails(db, new Date());
    const rows = await db
      .select()
      .from(weeklySummaryRecipients)
      .where(eq(weeklySummaryRecipients.summaryId, id));
    expect(rows.find((r) => r.userId === client.id)).toMatchObject({
      email: null,
      name: 'Stará Adresa',
      language: 'it',
      sentAt: old,
    });
    expect(rows.find((r) => r.userId === fresh.id)!.email).toBe(fresh.email);
  });

  it('purge never deletes a summary or a revision', async () => {
    const g = await makeGroup(db);
    const ids: string[] = [];
    const threeYears = 3 * 365 * DAY;
    for (const [i, status] of (['draft', 'sending', 'sent', 'skipped'] as const).entries()) {
      ids.push(
        await insertSummary(db, {
          groupId: g.id,
          week: `2023-W1${i}`,
          status,
          windowEnd: new Date(Date.now() - threeYears + i * DAY),
          createdAt: new Date(Date.now() - threeYears),
        }),
      );
    }
    await db.insert(weeklySummaryRevisions).values({
      id: crypto.randomUUID(),
      summaryId: ids[0]!,
      version: 1,
      content: sampleContent(),
      language: 'sk',
      source: 'facts',
      createdAt: new Date(Date.now() - threeYears),
    });
    await purgeRecipientEmails(db, new Date());
    expect(
      await db.select().from(weeklySummaries).where(inArray(weeklySummaries.id, ids)),
    ).toHaveLength(4);
    expect(
      await db
        .select()
        .from(weeklySummaryRevisions)
        .where(eq(weeklySummaryRevisions.summaryId, ids[0]!)),
    ).toHaveLength(1);
  });
});
