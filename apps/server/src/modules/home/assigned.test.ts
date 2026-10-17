import { afterAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { countAssignedTasks, getAssignedTasks } from './assigned.js';
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

describe('countAssignedTasks', () => {
  it("counts my open tasks only: not Completed, not unassigned, not others'", async () => {
    const g = await newGroup(db, 'Count');
    const me = await newAdmin(db, 'Ada', [g.id]);
    const other = await newAdmin(db, 'Bob', [g.id]);
    const done = await bucketOf(db, g.id, 'done');
    const base = { groupId: g.id, createdBy: me.id };
    await newTask(db, { ...base, assigneeIds: [me.id] });
    await newTask(db, { ...base, assigneeIds: [me.id, other.id], urgent: true });
    await newTask(db, { ...base, assigneeIds: [me.id], bucketId: done, completedAt: new Date() });
    await newTask(db, { ...base, assigneeIds: [other.id] });
    await newTask(db, base);
    expect(await countAssignedTasks(db, me.id)).toBe(2);
    expect(await countAssignedTasks(db, (await newAdmin(db, 'Cyril')).id)).toBe(0);
  });
});
