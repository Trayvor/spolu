import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { insertTask } from '../../../test/tasks.js';
import { addMember, createGroup } from '../groups/service.js';
import { reminderSets, reminderTimes } from '../reminders/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { countUpcomingReminders, taskReminderSubject } from './reminder-subject.js';
import { tasks } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });

async function newClient(groupId: string): Promise<SessionUser> {
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await db.insert(user).values({ id, email, name: 'Cleo', role: 'client', emailVerified: true });
  await addMember(db, groupId, id);
  return { id, email, name: 'Cleo', role: 'client' };
}

async function setup(opts: { done?: boolean } = {}) {
  const group = await newGroup();
  const email = `${randomUUID()}@example.com`;
  const row = await addAdmin(db, { email, name: 'Ada' });
  const admin: SessionUser = { id: row.id, email, name: 'Ada', role: 'admin' };
  const client = await newClient(group.id);
  const taskId = await insertTask(db, {
    groupId: group.id,
    createdBy: client.id,
    title: 'Fix the budget table',
    description: 'Check the totals',
    dueDate: '2030-01-15',
    done: opts.done,
  });
  return { group, admin, client, taskId };
}

describe('the task reminder subject', () => {
  it('loads a task as a subject', async () => {
    const { group, client, taskId } = await setup();
    const info = (await taskReminderSubject.loadMany(db, [taskId])).get(taskId)!;
    expect(info).toMatchObject({
      groupId: group.id,
      title: 'Fix the budget table',
      body: 'Check the totals',
      dueDate: '2030-01-15',
      adminsOnly: false,
      active: true,
      authorId: client.id,
      link: `/groups/${group.id}/tasks/${taskId}`,
    });
    expect(taskReminderSubject).toMatchObject({
      kind: 'task',
      routePrefix: 'tasks',
      standaloneEdit: true,
      addEditorsAsRecipients: true,
    });
  });

  it('active is false for a task in Completed', async () => {
    const { taskId } = await setup({ done: true });
    const info = (await taskReminderSubject.loadMany(db, [taskId])).get(taskId)!;
    expect(info.active).toBe(false);
  });

  it('read follows canUseBoard', async () => {
    const { group, admin, client, taskId } = await setup();
    const info = (await taskReminderSubject.loadMany(db, [taskId])).get(taskId)!;
    expect(info.canRead(client, [group.id])).toBe(true);
    expect(info.canRead(admin, [])).toBe(true);
    const other = await newGroup();
    const stranger = await newClient(other.id);
    expect(info.canRead(stranger, [other.id])).toBe(false);
    expect(info.canEdit(client)).toBe(true);
  });

  it('a deleted task is absent from loadMany', async () => {
    const { taskId } = await setup();
    await db.delete(tasks).where(eq(tasks.id, taskId));
    expect((await taskReminderSubject.loadMany(db, [taskId])).size).toBe(0);
    expect((await taskReminderSubject.loadMany(db, [])).size).toBe(0);
  });

  it('countUpcomingReminders counts unfired times per task in one query', async () => {
    const { group, client, taskId } = await setup();
    const empty = await insertTask(db, { groupId: group.id, createdBy: client.id });
    const setId = randomUUID();
    await db
      .insert(reminderSets)
      .values({ id: setId, groupId: group.id, taskId, createdBy: client.id });
    const at = new Date(Date.now() + 60 * 60_000);
    await db.insert(reminderTimes).values([
      { id: randomUUID(), setId, at },
      { id: randomUUID(), setId, at },
      { id: randomUUID(), setId, at, firedAt: new Date() },
    ]);
    const counts = await countUpcomingReminders(db, [taskId, empty]);
    expect(counts.get(taskId)).toBe(2);
    expect(counts.get(empty)).toBe(0);
  });
});
