import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { insertTask } from '../../../test/tasks.js';
import { createGroup } from '../groups/service.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { tasks } from '../tasks/schema.js';
import { addAdmin } from '../users/service.js';
import { reminderRecipients, reminderSets, reminderTimes } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

async function setup() {
  const group = await createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const admin = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Ada' });
  const taskId = await insertTask(db, { groupId: group.id, createdBy: admin.id });
  return { group, admin, taskId };
}

async function violatedConstraint(insert: Promise<unknown>): Promise<string | undefined> {
  try {
    await insert;
  } catch (error) {
    const pg = (error as { cause?: { constraint_name?: string } }).cause;
    return pg?.constraint_name ?? (error as { constraint_name?: string }).constraint_name;
  }
  return undefined;
}

describe('reminder_sets with tasks', () => {
  it('a reminder set with both a knowledge item and a task violates the check', async () => {
    const { group, admin, taskId } = await setup();
    const itemId = randomUUID();
    await db.insert(knowledgeItems).values({
      id: itemId,
      groupId: group.id,
      type: 'reminder',
      title: 'Report',
      createdBy: admin.id,
      searchText: 'report',
    });
    expect(
      await violatedConstraint(
        db.insert(reminderSets).values({
          id: randomUUID(),
          groupId: group.id,
          createdBy: admin.id,
          knowledgeItemId: itemId,
          taskId,
        }),
      ),
    ).toBe('reminder_sets_subject_check');
  });

  it('a reminder set with neither violates the check', async () => {
    const { group, admin } = await setup();
    expect(
      await violatedConstraint(
        db
          .insert(reminderSets)
          .values({ id: randomUUID(), groupId: group.id, createdBy: admin.id }),
      ),
    ).toBe('reminder_sets_subject_check');
  });

  it('a task has at most one reminder set', async () => {
    const { group, admin, taskId } = await setup();
    const values = { groupId: group.id, createdBy: admin.id, taskId };
    await db.insert(reminderSets).values({ id: randomUUID(), ...values });
    expect(
      await violatedConstraint(db.insert(reminderSets).values({ id: randomUUID(), ...values })),
    ).toBe('reminder_sets_task_unique');
  });

  it('deleting a task deletes its reminder set and times', async () => {
    const { group, admin, taskId } = await setup();
    const setId = randomUUID();
    await db
      .insert(reminderSets)
      .values({ id: setId, groupId: group.id, taskId, createdBy: admin.id });
    await db.insert(reminderTimes).values({ id: randomUUID(), setId, at: new Date() });
    await db
      .insert(reminderRecipients)
      .values({ setId, userId: admin.id, source: 'author', addedBy: admin.id });
    await db.delete(tasks).where(eq(tasks.id, taskId));
    expect(await db.select().from(reminderSets).where(eq(reminderSets.id, setId))).toEqual([]);
    expect(await db.select().from(reminderTimes).where(eq(reminderTimes.setId, setId))).toEqual([]);
    expect(
      await db.select().from(reminderRecipients).where(eq(reminderRecipients.setId, setId)),
    ).toEqual([]);
  });
});
