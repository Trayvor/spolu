import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { insertTask } from '../../../test/tasks.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { tasks } from '../tasks/schema.js';
import { NotDraftError, StaleVersionError } from './errors.js';
import { prepareWeek, runDraft } from './jobs.js';
import { weeklySummaries, weeklySummaryRevisions } from './schema.js';
import {
  getSummary,
  listRevisions,
  markRegenerating,
  olderDraftCount,
  pendingDraftCount,
  restoreRevision,
  updateDraft,
} from './service.js';
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
const thisWeek = () => isoWeek(new Date());
const lastWeek = () => isoWeek(new Date(Date.now() - 7 * DAY));

async function setup() {
  const g = await makeGroup(db);
  const manager = await makeManager(db, g.id);
  await makeClient(db, g.id);
  return { g, manager };
}

const revisionsOf = (summaryId: string) =>
  db.select().from(weeklySummaryRevisions).where(eq(weeklySummaryRevisions.summaryId, summaryId));

describe('weekly summary service', () => {
  it('updateDraft with an old version throws StaleVersionError carrying the current row', async () => {
    const { g, manager } = await setup();
    const id = await insertSummary(db, { groupId: g.id, week: thisWeek(), version: 2 });
    const error = await updateDraft(db, id, 1, sampleContent('X'), undefined, manager.id).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(StaleVersionError);
    expect((error as StaleVersionError).current).toMatchObject({ id, version: 2 });
    const saved = await updateDraft(db, id, 2, sampleContent('Nový'), 'it', manager.id);
    expect(saved).toMatchObject({ version: 3, language: 'it', updatedBy: manager.id });
  });

  it('updateDraft on a sent summary throws NotDraftError', async () => {
    const { g, manager } = await setup();
    const id = await insertSummary(db, { groupId: g.id, week: thisWeek(), status: 'sent' });
    await expect(
      updateDraft(db, id, 1, sampleContent(), undefined, manager.id),
    ).rejects.toBeInstanceOf(NotDraftError);
  });

  it('pendingDraftCount counts drafts of the week in groups the admin manages', async () => {
    const a = await setup();
    const b = await makeGroup(db);
    await makeManager(db, b.id);
    await insertSummary(db, { groupId: a.g.id, week: thisWeek() });
    await insertSummary(db, { groupId: b.id, week: thisWeek() });
    expect(await pendingDraftCount(db, a.manager.id, thisWeek())).toBe(1);
  });

  it('olderDraftCount counts drafts of earlier weeks in groups the admin manages', async () => {
    const a = await setup();
    await insertSummary(db, {
      groupId: a.g.id,
      week: lastWeek(),
      windowEnd: new Date(Date.now() - 7 * DAY),
    });
    await insertSummary(db, { groupId: a.g.id, week: thisWeek() });
    expect(await olderDraftCount(db, [a.g.id], thisWeek())).toBe(1);
    expect(await olderDraftCount(db, [], thisWeek())).toBe(0);
  });

  it('every content write rewrites search_text', async () => {
    const { g, manager } = await setup();
    const taskId = await insertTask(db, {
      groupId: g.id,
      createdBy: manager.id,
      title: 'Žiadosť o platbu',
    });
    await db
      .update(tasks)
      .set({ completedAt: new Date(Date.now() - DAY) })
      .where(eq(tasks.id, taskId));
    const { deps } = weeklyHarness(db);
    await prepareWeek(deps, new Date(), { groupIds: [g.id] });
    const [row] = await db.select().from(weeklySummaries).where(eq(weeklySummaries.groupId, g.id));
    expect(row!.searchText).toContain('Žiadosť o platbu');
    const edited = await updateDraft(
      db,
      row!.id,
      row!.version,
      sampleContent('Upravené'),
      undefined,
      manager.id,
    );
    expect(edited!.searchText).toContain('Upravené');
    const regenerating = await markRegenerating(
      db,
      row!.id,
      edited!.version,
      undefined,
      manager.id,
    );
    await runDraft(deps, row!.id);
    const regenerated = await getSummary(db, row!.id);
    expect(regenerated!.searchText).toContain('Žiadosť o platbu');
    expect(regenerated!.searchText).not.toContain('Upravené');
    const [revision] = await listRevisions(db, row!.id);
    const restored = await restoreRevision(
      db,
      row!.id,
      revision!.id,
      regenerating!.version + 1,
      manager.id,
    );
    expect(restored!.searchText).toContain('Upravené');
  });

  it('regenerate keeps the replaced text as a revision', async () => {
    const { g, manager } = await setup();
    const content = sampleContent('Pôvodný text');
    const id = await insertSummary(db, { groupId: g.id, week: thisWeek(), content, version: 4 });
    const row = await markRegenerating(db, id, 4, 'en', manager.id);
    expect(row).toMatchObject({ status: 'preparing', version: 5, language: 'en' });
    const revisions = await revisionsOf(id);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({
      version: 4,
      content,
      language: 'sk',
      createdBy: manager.id,
    });
    const { deps } = weeklyHarness(db);
    await runDraft(deps, id);
    // a regeneration is never skipped for lack of activity: the manager asked for a draft
    expect(await getSummary(db, id)).toMatchObject({ status: 'draft', language: 'en', version: 6 });
  });

  it('restore keeps the replaced text as a revision too', async () => {
    const { g, manager } = await setup();
    const first = sampleContent('Prvá verzia');
    const id = await insertSummary(db, { groupId: g.id, week: thisWeek(), content: first });
    await markRegenerating(db, id, 1, undefined, manager.id);
    await db
      .update(weeklySummaries)
      .set({ status: 'draft', content: sampleContent('Druhá verzia') })
      .where(eq(weeklySummaries.id, id));
    const [revision] = await listRevisions(db, id);
    const restored = await restoreRevision(db, id, revision!.id, 2, manager.id);
    expect(restored!.content).toEqual(first);
    const all = await listRevisions(db, id);
    expect(all.map((r) => r.content.done[0]!.text)).toEqual(['Druhá verzia', 'Prvá verzia']);
    expect(all[0]!.createdBy).toEqual({ name: manager.name });
  });

  it("an old week's draft can still be updated", async () => {
    const { g, manager } = await setup();
    const id = await insertSummary(db, {
      groupId: g.id,
      week: isoWeek(new Date(Date.now() - 21 * DAY)),
      windowEnd: new Date(Date.now() - 21 * DAY),
    });
    const saved = await updateDraft(db, id, 1, sampleContent('Neskoro'), undefined, manager.id);
    expect(saved).toMatchObject({ status: 'draft', version: 2 });
  });
});
