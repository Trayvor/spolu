import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { insertTask } from '../../../test/tasks.js';
import { createGroup } from '../groups/service.js';
import { createEvent, createProject } from '../projects/service.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { backfillEntryProjects, BACKFILL_PROJECTS } from './backfill-projects.js';
import { financeBackfills, financeTimeEntries } from './schema.js';

/**
 * The startup job `finance.backfill-projects` (Phase 33 P6): entries made before migration 0045
 * get their task's or ticket's project and event, asked through the tasks and tickets modules in
 * batches; it runs once (a done mark), never overwrites a copy the hooks wrote, and leaves manual
 * entries alone.
 */
const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

describe('finance.backfill-projects', () => {
  let adminId: string;
  beforeAll(async () => {
    adminId = randomUUID();
    await db
      .insert(user)
      .values({ id: adminId, email: `${adminId}@example.com`, name: 'A', role: 'admin' });
  });

  it('copies the projects of old task and ticket entries once, in batches', async () => {
    const groupId = (
      await createGroup(db, {
        name: 'Firma',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      })
    ).id;
    const p = (
      await createProject(db, adminId, groupId, { name: 'P', description: '', fileIds: [] })
    ).id;
    const q = (
      await createProject(db, adminId, groupId, { name: 'Q', description: '', fileIds: [] })
    ).id;
    const e = (
      await createEvent(db, adminId, p, {
        name: 'E',
        description: '',
        occursOn: '2026-05-05',
        fileIds: [],
      })
    ).id;
    const taskIds = [];
    for (let i = 0; i < 5; i++) {
      taskIds.push(
        await insertTask(db, { groupId, createdBy: adminId, projectId: p, eventId: e, done: true }),
      );
    }
    const plainTask = await insertTask(db, { groupId, createdBy: adminId, done: true });
    const ticketId = randomUUID();
    await db.insert(tickets).values({
      id: ticketId,
      groupId,
      source: 'manual',
      subject: 'T',
      projectId: q,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const base = {
      groupId,
      userId: adminId,
      title: 'Old',
      minutes: 30,
      workedOn: '2026-05-05',
      createdBy: adminId,
      updatedBy: adminId,
    };
    const rows = [
      ...taskIds.map((taskId) => ({ id: randomUUID(), source: 'task' as const, taskId })),
      { id: randomUUID(), source: 'task' as const, taskId: plainTask },
      { id: randomUUID(), source: 'ticket' as const, ticketId },
      { id: randomUUID(), source: 'manual' as const, title: null },
    ];
    await db.insert(financeTimeEntries).values(rows.map((r) => ({ ...base, ...r })));
    // A copy the hooks wrote after the migration is never overwritten.
    const hooked = randomUUID();
    const hookTask = await insertTask(db, {
      groupId,
      createdBy: adminId,
      projectId: p,
      done: true,
    });
    await db
      .insert(financeTimeEntries)
      .values({ ...base, id: hooked, source: 'task', taskId: hookTask, projectId: q });

    await db.delete(financeBackfills).where(eq(financeBackfills.name, BACKFILL_PROJECTS));
    const result = await backfillEntryProjects(db, { batchSize: 2 });
    expect(result.skipped).toBe(false);
    expect(result.updated).toBeGreaterThanOrEqual(6);

    const after = await db
      .select({
        id: financeTimeEntries.id,
        projectId: financeTimeEntries.projectId,
        eventId: financeTimeEntries.eventId,
      })
      .from(financeTimeEntries)
      .where(inArray(financeTimeEntries.id, [...rows.map((r) => r.id), hooked]));
    const byId = new Map(after.map((r) => [r.id, [r.projectId, r.eventId]]));
    for (const r of rows.slice(0, 5)) expect(byId.get(r.id)).toEqual([p, e]);
    expect(byId.get(rows[5]!.id)).toEqual([null, null]);
    expect(byId.get(rows[6]!.id)).toEqual([q, null]);
    expect(byId.get(rows[7]!.id)).toEqual([null, null]);
    expect(byId.get(hooked)).toEqual([q, null]);

    // Done: a second start does nothing.
    expect(await backfillEntryProjects(db)).toEqual({ skipped: true, scanned: 0, updated: 0 });
  });
});
