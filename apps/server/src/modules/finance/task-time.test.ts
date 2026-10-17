import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { insertTask } from '../../../test/tasks.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { financeTimeEntries } from './schema.js';
import {
  bratislavaDay,
  countMyTimeRequests,
  listMyTimeRequests,
  onAssigneesRemoved,
  onTaskCompleted,
  onTaskDeleting,
  onTaskReopened,
  writeTaskTime,
} from './task-time.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const email = () => `${randomUUID()}@example.com`;
const admin = async (name = 'Eva') => (await addAdmin(db, { email: email(), name })).id;
async function client() {
  const id = randomUUID();
  await db.insert(user).values({ id, email: email(), name: 'Client', role: 'client' });
  return id;
}
const newGroup = () =>
  createGroup(db, { name: 'Firma', egrantUrl: `https://g${randomUUID().slice(0, 8)}.egrant.sk` });

async function setup() {
  const group = await newGroup();
  const [a, b, c] = [await admin('Eva'), await admin('Ján'), await client()];
  const taskId = await insertTask(db, { groupId: group.id, createdBy: a, assignees: [a, b, c] });
  return { groupId: group.id, a, b, c, taskId };
}

const entries = (taskId: string) =>
  db.select().from(financeTimeEntries).where(eq(financeTimeEntries.taskId, taskId));

const completed = (
  s: { groupId: string; taskId: string; a: string; b: string; c: string },
  actorId: string,
  over: Partial<Parameters<typeof onTaskCompleted>[1]> = {},
) =>
  onTaskCompleted(db, {
    taskId: s.taskId,
    groupId: s.groupId,
    title: 'Fix the budget table',
    completedAt: new Date('2026-10-17T22:30:00Z'), // 18 October in Bratislava
    actorId,
    actorName: 'Actor',
    assigneeIds: [s.a, s.b, s.c],
    sourceTicketId: null,
    ...over,
  });

async function timeEvents(taskId: string) {
  const rows = await db
    .select({ userId: notificationEvents.userId, payload: notificationEvents.payload })
    .from(notificationEvents)
    .where(eq(notificationEvents.kind, 'task.time_missing'));
  return rows.filter((r) => (r.payload as { taskId?: string }).taskId === taskId);
}

describe('bratislavaDay', () => {
  it('is the calendar day in Europe/Bratislava', () => {
    expect(bratislavaDay(new Date('2026-10-17T22:30:00Z'))).toBe('2026-10-18');
    expect(bratislavaDay(new Date('2026-01-01T12:00:00Z'))).toBe('2026-01-01');
  });
});

describe('onTaskCompleted', () => {
  it('asks the acting admin assignee and notifies the other admin assignees, never a client', async () => {
    const s = await setup();
    const result = await completed(s, s.a);
    expect(result.askActor).toBe(true);
    expect(result.notified).toEqual([s.b]);
    expect(result.eventIds).toHaveLength(1);
    const rows = await entries(s.taskId);
    expect(rows.map((r) => r.userId).sort()).toEqual([s.a, s.b].sort());
    for (const row of rows) {
      expect(row).toMatchObject({
        source: 'task',
        minutes: null,
        workedOn: '2026-10-18',
        groupId: s.groupId,
        title: 'Fix the budget table',
      });
    }
    expect((await timeEvents(s.taskId)).map((e) => e.userId)).toEqual([s.b]);
  });

  it('a non-assignee admin or a client completing: no dialog, every admin assignee notified', async () => {
    const s = await setup();
    const other = await admin('Other');
    const byAdmin = await completed(s, other);
    expect(byAdmin.askActor).toBe(false);
    expect(byAdmin.notified.sort()).toEqual([s.a, s.b].sort());

    const t = await setup();
    const byClient = await completed(t, t.c);
    expect(byClient.askActor).toBe(false);
    expect(byClient.notified.sort()).toEqual([t.a, t.b].sort());
  });

  it('does nothing for a task with only client assignees or none', async () => {
    const s = await setup();
    const result = await completed(s, s.a, { assigneeIds: [s.c] });
    expect(result).toMatchObject({ askActor: false, notified: [], changed: false });
    expect(await entries(s.taskId)).toEqual([]);
    expect((await completed(s, s.a, { assigneeIds: [] })).changed).toBe(false);
  });

  it('dates an entry filled before completion and asks nothing for it', async () => {
    const s = await setup();
    await writeTaskTime(db, s.a, { ...s, title: 'T', completedAt: null, sourceTicketId: null }, 45);
    const [before] = await entries(s.taskId);
    expect(before).toMatchObject({ minutes: 45, workedOn: null });
    const result = await completed(s, s.a);
    expect(result.askActor).toBe(false);
    expect(result.notified).toEqual([s.b]);
    const mine = (await entries(s.taskId)).find((r) => r.userId === s.a);
    expect(mine).toMatchObject({ minutes: 45, workedOn: '2026-10-18' });
  });

  it('re-completing asks only the admins without filled time; the first day stays', async () => {
    const s = await setup();
    await completed(s, s.a);
    await writeTaskTime(
      db,
      s.a,
      { ...s, title: 'T', completedAt: new Date('2026-10-17T22:30:00Z'), sourceTicketId: null },
      90,
    );
    expect((await onTaskReopened(db, s.taskId)).sort()).toEqual([s.b]);
    const again = await completed(s, s.b, { completedAt: new Date('2026-11-02T10:00:00Z') });
    expect(again.askActor).toBe(true);
    expect(again.notified).toEqual([]);
    const rows = await entries(s.taskId);
    expect(rows.find((r) => r.userId === s.a)).toMatchObject({
      minutes: 90,
      workedOn: '2026-10-18',
    });
    expect(rows.find((r) => r.userId === s.b)).toMatchObject({
      minutes: null,
      workedOn: '2026-11-02',
    });
  });

  it('copies the source ticket into the entries (the work-log unit)', async () => {
    const s = await setup();
    const { tickets } = await import('../tickets/schema.js');
    const ticketId = randomUUID();
    await db.insert(tickets).values({
      id: ticketId,
      groupId: s.groupId,
      source: 'manual',
      requesterName: 'R',
      requesterEmail: email(),
      body: 'b',
      createdBy: s.a,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await completed(s, s.a, { sourceTicketId: ticketId });
    for (const row of await entries(s.taskId)) expect(row.linkedTicketId).toBe(ticketId);
  });

  it('two admins completing at once leave one entry each (the unique index)', async () => {
    const s = await setup();
    await Promise.all([completed(s, s.a), completed(s, s.b)]);
    expect(await entries(s.taskId)).toHaveLength(2);
  });
});

describe('reopen, removal, delete', () => {
  it('reopening deletes the requests only; filled time stays', async () => {
    const s = await setup();
    await completed(s, s.a);
    await db
      .update(financeTimeEntries)
      .set({ minutes: 30 })
      .where(and(eq(financeTimeEntries.taskId, s.taskId), eq(financeTimeEntries.userId, s.a)));
    expect(await onTaskReopened(db, s.taskId)).toEqual([s.b]);
    expect((await entries(s.taskId)).map((r) => r.userId)).toEqual([s.a]);
  });

  it('removing an assignee deletes their request, not their filled time', async () => {
    const s = await setup();
    await completed(s, s.a);
    await db
      .update(financeTimeEntries)
      .set({ minutes: 30 })
      .where(and(eq(financeTimeEntries.taskId, s.taskId), eq(financeTimeEntries.userId, s.a)));
    expect((await onAssigneesRemoved(db, s.taskId, [s.a, s.b])).sort()).toEqual([s.b]);
    expect((await entries(s.taskId)).map((r) => r.userId)).toEqual([s.a]);
  });

  it('deleting the task deletes its requests; filled entries keep their title', async () => {
    const s = await setup();
    await completed(s, s.a);
    await db
      .update(financeTimeEntries)
      .set({ minutes: 30 })
      .where(and(eq(financeTimeEntries.taskId, s.taskId), eq(financeTimeEntries.userId, s.a)));
    expect(await onTaskDeleting(db, s.taskId)).toEqual([s.b]);
    const { tasks } = await import('../tasks/schema.js');
    await db.delete(tasks).where(eq(tasks.id, s.taskId));
    const kept = await db
      .select()
      .from(financeTimeEntries)
      .where(and(eq(financeTimeEntries.userId, s.a), eq(financeTimeEntries.groupId, s.groupId)));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ taskId: null, title: 'Fix the budget table', minutes: 30 });
  });
});

describe('listMyTimeRequests', () => {
  it('lists the caller own open requests, oldest first, and counts them', async () => {
    const s = await setup();
    const t = await insertTask(db, { groupId: s.groupId, createdBy: s.a, assignees: [s.b] });
    await completed(s, s.a, { completedAt: new Date('2026-10-20T10:00:00Z') });
    await onTaskCompleted(db, {
      taskId: t,
      groupId: s.groupId,
      title: 'Older',
      completedAt: new Date('2026-10-10T10:00:00Z'),
      actorId: s.a,
      actorName: 'A',
      assigneeIds: [s.b],
      sourceTicketId: null,
    });
    const rows = await listMyTimeRequests(db, s.b, 20);
    expect(rows.map((r) => [r.kind, r.taskId, r.workedOn])).toEqual([
      ['task', t, '2026-10-10'],
      ['task', s.taskId, '2026-10-20'],
    ]);
    expect(await countMyTimeRequests(db, s.b)).toBe(2);
    expect(await listMyTimeRequests(db, s.b, 1)).toHaveLength(1);
    await writeTaskTime(
      db,
      s.b,
      { ...s, taskId: t, title: 'Older', completedAt: new Date(), sourceTicketId: null },
      0,
    );
    expect(await countMyTimeRequests(db, s.b)).toBe(1);
  });
});
