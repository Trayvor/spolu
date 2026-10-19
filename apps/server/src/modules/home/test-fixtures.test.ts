import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { TaskCreateSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { insertTask } from '../../../test/tasks.js';
import { keyAfter } from '../tasks/positions.js';
import { tasks } from '../tasks/schema.js';
import { createTask } from '../tasks/task-service.js';
import { deactivateUser } from '../users/service.js';
import { newAdmin, newGroup, newTask } from './test-fixtures.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/**
 * The fixtures write task rows straight into buckets that other tests share (the admin group's
 * board is one for every test file), so their positions must be valid fractional-indexing keys:
 * a task created later in the same bucket computes its key from the last one. An invalid key
 * there made every later task in that bucket fail with 500 (2026-10-19, after #185).
 */
describe('task row fixtures', () => {
  let test: TestApp;
  const admins: string[] = [];
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.close();
  });
  const db = () => test.deps.db;
  const positionOf = async (id: string) =>
    (await db().select({ p: tasks.position }).from(tasks).where(eq(tasks.id, id)))[0]!.p;

  it('newTask writes valid keys in creation order', async () => {
    const g = await newGroup(db());
    const a = await newAdmin(db());
    admins.push(a.id);
    const p1 = await positionOf(await newTask(db(), { groupId: g.id, createdBy: a.id }));
    const p2 = await positionOf(await newTask(db(), { groupId: g.id, createdBy: a.id }));
    expect(() => keyAfter(p1, p2)).not.toThrow();
    expect(() => keyAfter(p2, null)).not.toThrow();
  });

  it('insertTask writes valid keys', async () => {
    const g = await newGroup(db());
    const a = await newAdmin(db());
    admins.push(a.id);
    for (let i = 0; i < 40; i++) {
      const p = await positionOf(await insertTask(db(), { groupId: g.id, createdBy: a.id }));
      expect(() => keyAfter(p, null), p).not.toThrow();
    }
  });

  it('lets the task service add a task after a fixture task in the same bucket', async () => {
    const g = await newGroup(db());
    const a = await newAdmin(db(), 'Ada', [g.id]);
    admins.push(a.id);
    await newTask(db(), { groupId: g.id, createdBy: a.id });
    const created = await createTask(
      test.deps,
      a,
      g.id,
      TaskCreateSchema.parse({ title: 'Ďalšia' }),
    );
    expect(created.title).toBe('Ďalšia');
  });
});
