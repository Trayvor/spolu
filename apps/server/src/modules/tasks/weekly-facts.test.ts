import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb, type Db } from '../../infra/db/client.js';
import { insertTask } from '../../../test/tasks.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { makeAdmin, makeGroup } from '../weekly-summary/test-fixtures.js';
import { buckets, tasks } from './schema.js';
import {
  doneTasksOf,
  dueTasksOf,
  taskRefsInGroup,
  taskTitlesInGroup,
  waitingOnClientTasksOf,
} from './weekly-facts.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const DAY = 86_400_000;

async function setCompleted(id: string, at: Date) {
  await db.update(tasks).set({ completedAt: at }).where(eq(tasks.id, id));
}

/** Moves a task into the group's bucket of `kind` at `position`. */
async function moveTo(d: Db, groupId: string, id: string, kind: string, position: string) {
  const [bucket] = await d
    .select({ id: buckets.id })
    .from(buckets)
    .where(and(eq(buckets.groupId, groupId), eq(buckets.kind, kind)));
  await d.update(tasks).set({ bucketId: bucket!.id, position }).where(eq(tasks.id, id));
}

describe('tasks: weekly summary facts', () => {
  it('doneTasksOf lists tasks completed in the window only', async () => {
    const g = await makeGroup(db);
    const a = await makeAdmin(db);
    const to = new Date();
    const from = new Date(to.getTime() - 7 * DAY);
    const before = await insertTask(db, { groupId: g.id, createdBy: a.id, done: true });
    const inside = await insertTask(db, {
      groupId: g.id,
      createdBy: a.id,
      done: true,
      title: 'In',
    });
    const atEnd = await insertTask(db, { groupId: g.id, createdBy: a.id, done: true });
    await insertTask(db, { groupId: g.id, createdBy: a.id });
    await setCompleted(before, new Date(from.getTime() - 1000));
    await setCompleted(inside, new Date(from.getTime() + DAY));
    await setCompleted(atEnd, to);
    const rows = await doneTasksOf(db, g.id, from, to);
    expect(rows.map((r) => r.id)).toEqual([inside]);
    expect(rows[0]).toMatchObject({ title: 'In' });
  });

  it("doneTasksOf never returns another group's task", async () => {
    const [g, other] = [await makeGroup(db), await makeGroup(db)];
    const a = await makeAdmin(db);
    await insertTask(db, { groupId: other.id, createdBy: a.id, done: true });
    const to = new Date(Date.now() + 1000);
    expect(await doneTasksOf(db, g.id, new Date(to.getTime() - DAY), to)).toEqual([]);
  });

  it('waitingOnClientTasksOf lists open client_review tasks by position', async () => {
    const g = await makeGroup(db);
    const a = await makeAdmin(db);
    const second = await insertTask(db, { groupId: g.id, createdBy: a.id, title: 'B' });
    const first = await insertTask(db, { groupId: g.id, createdBy: a.id, title: 'A' });
    const done = await insertTask(db, { groupId: g.id, createdBy: a.id, title: 'Done' });
    await insertTask(db, { groupId: g.id, createdBy: a.id, title: 'Todo' });
    await moveTo(db, g.id, second, 'client_review', 'b0');
    await moveTo(db, g.id, first, 'client_review', 'a0');
    await moveTo(db, g.id, done, 'client_review', 'c0');
    await setCompleted(done, new Date());
    const rows = await waitingOnClientTasksOf(db, g.id);
    expect(rows.map((r) => r.title)).toEqual(['A', 'B']);
  });

  it('dueTasksOf includes both ends and skips completed tasks', async () => {
    const g = await makeGroup(db);
    const a = await makeAdmin(db);
    const start = await insertTask(db, { groupId: g.id, createdBy: a.id, dueDate: '2030-01-01' });
    const end = await insertTask(db, { groupId: g.id, createdBy: a.id, dueDate: '2030-01-14' });
    await insertTask(db, { groupId: g.id, createdBy: a.id, dueDate: '2030-01-15' });
    await insertTask(db, { groupId: g.id, createdBy: a.id, dueDate: '2029-12-31' });
    await insertTask(db, { groupId: g.id, createdBy: a.id, dueDate: '2030-01-05', done: true });
    const rows = await dueTasksOf(db, g.id, '2030-01-01', '2030-01-14');
    expect(rows.map((r) => [r.id, r.dueDate])).toEqual([
      [start, '2030-01-01'],
      [end, '2030-01-14'],
    ]);
  });

  it('taskRefsInGroup keeps only ids of the group', async () => {
    const [g, other] = [await makeGroup(db), await makeGroup(db)];
    const a = await makeAdmin(db);
    const mine = await insertTask(db, { groupId: g.id, createdBy: a.id, title: 'Mine' });
    const theirs = await insertTask(db, { groupId: other.id, createdBy: a.id });
    const gone = await insertTask(db, { groupId: g.id, createdBy: a.id });
    await db.delete(tasks).where(eq(tasks.id, gone));
    const refs = await taskRefsInGroup(db, g.id, [mine, theirs, gone, randomUUID()]);
    expect([...refs]).toEqual([mine]);
    expect(await taskTitlesInGroup(db, g.id, [mine])).toEqual(new Map([[mine, 'Mine']]));
    expect(await taskRefsInGroup(db, g.id, [])).toEqual(new Set());
  });
});
