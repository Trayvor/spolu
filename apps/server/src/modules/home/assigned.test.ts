import { afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { markTaskSeen } from '../notifications/unseen.js';
import { recordNotifications } from '../notifications/service.js';
import { countUnseenTasks, getAssignedTasks } from './assigned.js';
import { bucketOf, newAdmin, newGroup, newTask } from './test-fixtures.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const at = (iso: string) => new Date(iso);

describe('getAssignedTasks', () => {
  it('exact order', async () => {
    const g = await newGroup(db, 'Order');
    const me = await newAdmin(db, 'Ada', [g.id]);
    const task = (title: string, extra: Partial<Parameters<typeof newTask>[1]>) =>
      newTask(db, { groupId: g.id, createdBy: me.id, assigneeIds: [me.id], title, ...extra });
    // Inserted out of order on purpose.
    await task('no date newer', { createdAt: at('2026-10-02T10:00:00Z') });
    await task('due 25 Oct', { dueDate: '2026-10-25' });
    await task('urgent no date', { urgent: true });
    await task('no date older', { createdAt: at('2026-10-01T10:00:00Z') });
    await task('overdue 1 Oct', { dueDate: '2026-10-01' });
    await task('urgent 20 Oct', { urgent: true, dueDate: '2026-10-20' });
    const result = await getAssignedTasks(db, me.id);
    expect(result.items.map((t) => t.title)).toEqual([
      'urgent 20 Oct',
      'urgent no date',
      'overdue 1 Oct',
      'due 25 Oct',
      'no date older',
      'no date newer',
    ]);
    expect(result.items[0]).toMatchObject({
      groupId: g.id,
      groupName: 'Order',
      urgent: true,
      dueDate: '2026-10-20',
      bucketKind: 'todo',
    });
  });

  it('totals and urgent count; Completed excluded', async () => {
    const g = await newGroup(db, 'Totals');
    const me = await newAdmin(db, 'Ada', [g.id]);
    const other = await newAdmin(db, 'Bob', [g.id]);
    const done = await bucketOf(db, g.id, 'done');
    const base = { groupId: g.id, createdBy: me.id, assigneeIds: [me.id] };
    await newTask(db, { ...base, urgent: true });
    await newTask(db, base);
    await newTask(db, { ...base, urgent: true, bucketId: done, completedAt: new Date() });
    await newTask(db, { ...base, assigneeIds: [other.id] });
    expect(await getAssignedTasks(db, me.id)).toMatchObject({ total: 2, urgent: 1 });
  });

  it('nothing assigned gives zeros', async () => {
    const me = await newAdmin(db, 'Ada');
    expect(await getAssignedTasks(db, me.id)).toEqual({
      total: 0,
      urgent: 0,
      items: [],
      timeRequests: [],
      timeRequestCount: 0,
    });
  });

  it('first 20 only, total counts all', async () => {
    const g = await newGroup(db, 'Many');
    const me = await newAdmin(db, 'Ada', [g.id]);
    for (let i = 0; i < 23; i++) {
      await newTask(db, { groupId: g.id, createdBy: me.id, assigneeIds: [me.id] });
    }
    const result = await getAssignedTasks(db, me.id);
    expect(result.total).toBe(23);
    expect(result.items).toHaveLength(20);
  });

  // Phase 32: plus one statement for the time requests (rows and count together).
  it('two statements', async () => {
    const me = await newAdmin(db, 'Ada');
    const client = postgres(testDatabaseUrl, { max: 1 });
    let statements = 0;
    const counted = drizzle(client, { logger: { logQuery: () => void statements++ } });
    try {
      await getAssignedTasks(counted, me.id);
      expect(statements).toBe(2);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});

const moved = (userId: string, groupId: string, taskId: string) =>
  recordNotifications(db, {
    kind: 'task.moved',
    groupId,
    recipients: [userId],
    payload: { taskId, groupId },
  });

describe('unseen tasks (2026-10-17)', () => {
  it('a card is marked while its task has a change I have not seen', async () => {
    const g = await newGroup(db, 'Unseen card');
    const me = await newAdmin(db, 'Ada', [g.id]);
    const changed = await newTask(db, { groupId: g.id, createdBy: me.id, assigneeIds: [me.id] });
    const quiet = await newTask(db, { groupId: g.id, createdBy: me.id, assigneeIds: [me.id] });
    await moved(me.id, g.id, changed);
    const unseen = async () =>
      Object.fromEntries((await getAssignedTasks(db, me.id)).items.map((t) => [t.id, t.unseen]));
    expect(await unseen()).toEqual({ [changed]: 'change', [quiet]: null });
    await markTaskSeen(db, me.id, changed);
    expect(await unseen()).toEqual({ [changed]: null, [quiet]: null });
  });

  it("the header counts my tasks with an unseen change, completed and others' too", async () => {
    const g = await newGroup(db, 'Count');
    const me = await newAdmin(db, 'Ada', [g.id]);
    const other = await newAdmin(db, 'Bob', [g.id]);
    const done = await bucketOf(db, g.id, 'done');
    const base = { groupId: g.id, createdBy: me.id };
    const open = await newTask(db, { ...base, assigneeIds: [me.id] });
    const completed = await newTask(db, {
      ...base,
      assigneeIds: [me.id],
      bucketId: done,
      completedAt: new Date(),
    });
    const created = await newTask(db, { ...base, assigneeIds: [other.id] });
    await newTask(db, { ...base, assigneeIds: [me.id] });
    expect(await countUnseenTasks(db, me.id)).toBe(0);
    for (const id of [open, completed, created]) await moved(me.id, g.id, id);
    await moved(other.id, g.id, created);
    expect(await countUnseenTasks(db, me.id)).toBe(3);
    await markTaskSeen(db, me.id, completed);
    expect(await countUnseenTasks(db, me.id)).toBe(2);
    expect(await countUnseenTasks(db, other.id)).toBe(1);
    expect(await countUnseenTasks(db, (await newAdmin(db, 'Cyril')).id)).toBe(0);
  });
});
