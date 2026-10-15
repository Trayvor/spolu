import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import type { JobQueue } from '../../infra/jobs/jobs.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { createUnverifiedClient } from '../users/service.js';
import {
  bratislavaDay,
  bratislavaHour,
  recordDeadlineReminders,
  recordUrgentReminders,
} from './reminders.js';
import { buckets, taskAssignees, tasks } from './schema.js';
import { ensureBoard } from './service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(close);

function makeDeps() {
  const send = vi.fn(async () => {});
  return { send, deps: { db, jobs: { send } as JobQueue } };
}

/** A group, one assignee, and a way to add tasks straight into the table. */
async function setup() {
  const group = await createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
  const assignee = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
  await ensureBoard(db, group.id);
  const bucketRows = await db.select().from(buckets).where(eq(buckets.groupId, group.id));
  const bucket = (kind: string) => bucketRows.find((b) => b.kind === kind)!;

  let n = 0;
  async function addTask(
    opts: {
      dueDate?: string | null;
      urgent?: boolean;
      done?: boolean;
      assignees?: string[];
    } = {},
  ) {
    const id = randomUUID();
    const at = new Date();
    n += 1;
    await db.insert(tasks).values({
      id,
      groupId: group.id,
      bucketId: bucket(opts.done ? 'done' : 'todo').id,
      position: `a${n}`,
      title: `Task ${n}`,
      createdBy: assignee.id,
      dueDate: opts.dueDate ?? null,
      urgent: opts.urgent ?? false,
      completedAt: opts.done ? at : null,
      createdAt: at,
      updatedAt: at,
    });
    const people = opts.assignees ?? [assignee.id];
    if (people.length > 0) {
      await db.insert(taskAssignees).values(people.map((userId) => ({ taskId: id, userId })));
    }
    return id;
  }
  const events = (kind: string, userIds = [assignee.id]) =>
    db
      .select()
      .from(notificationEvents)
      .where(and(eq(notificationEvents.kind, kind), inArray(notificationEvents.userId, userIds)));
  return { group, assignee, addTask, events };
}

describe('Bratislava time helpers', () => {
  it('uses the Bratislava date and hour, summer and winter', () => {
    expect(bratislavaDay(new Date('2026-10-16T23:30:00Z'))).toBe('2026-10-17');
    expect(bratislavaHour(new Date('2026-10-16T23:30:00Z'))).toBe(1);
    expect(bratislavaHour(new Date('2026-10-25T19:00:00Z'))).toBe(20); // after the clocks went back
    expect(bratislavaHour(new Date('2026-10-24T18:00:00Z'))).toBe(20); // still summer time
    expect(bratislavaHour(new Date('2026-10-16T22:00:00Z'))).toBe(0); // never 24
  });
});

describe('recordDeadlineReminders', () => {
  const now = new Date('2026-10-16T07:00:00Z'); // 09:00 in Bratislava, day 2026-10-16

  it('reminds for tasks due in 3, 2 and 1 days, not 0 or 4', async () => {
    const { assignee, group, addTask, events } = await setup();
    const { deps, send } = makeDeps();
    const due0 = await addTask({ dueDate: '2026-10-16' });
    const due1 = await addTask({ dueDate: '2026-10-17' });
    const due2 = await addTask({ dueDate: '2026-10-18' });
    const due3 = await addTask({ dueDate: '2026-10-19' });
    const due4 = await addTask({ dueDate: '2026-10-20' });
    await addTask({ dueDate: null });

    await recordDeadlineReminders(deps, now);

    const rows = await events('task.deadline');
    const byTask = Object.fromEntries(
      rows.map((r) => [(r.payload as { taskId: string }).taskId, r]),
    );
    expect(Object.keys(byTask).sort()).toEqual([due1, due2, due3].sort());
    expect(byTask[due0]).toBeUndefined();
    expect(byTask[due4]).toBeUndefined();
    expect(byTask[due1]!.payload).toMatchObject({ groupId: group.id, daysLeft: 1 });
    expect(byTask[due2]!.payload).toMatchObject({ daysLeft: 2 });
    expect(byTask[due3]!.payload).toMatchObject({ daysLeft: 3 });
    expect(byTask[due1]).toMatchObject({
      userId: assignee.id,
      groupId: group.id,
      dedupeKey: `deadline:${due1}:2026-10-16`,
    });
    expect(send).toHaveBeenCalledWith('notifications.deliver', {
      userIds: expect.arrayContaining([assignee.id]),
    });
  });

  it('records nothing for a completed task', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    await addTask({ dueDate: '2026-10-17', done: true });
    await recordDeadlineReminders(deps, now);
    expect(await events('task.deadline')).toHaveLength(0);
  });

  it('running twice on the same day records once', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    await addTask({ dueDate: '2026-10-18' });
    await recordDeadlineReminders(deps, now);
    await recordDeadlineReminders(deps, new Date('2026-10-16T07:05:00Z'));
    expect(await events('task.deadline')).toHaveLength(1);
    // The next day is a new reminder.
    await recordDeadlineReminders(deps, new Date('2026-10-17T07:00:00Z'));
    expect(await events('task.deadline')).toHaveLength(2);
  });

  it('uses the Bratislava date at 23:30 UTC', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    // 2026-10-16 23:30 UTC is already 2026-10-17 in Bratislava, so 2026-10-18 is one day away.
    await addTask({ dueDate: '2026-10-18' });
    await recordDeadlineReminders(deps, new Date('2026-10-16T23:30:00Z'));
    const rows = await events('task.deadline');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.payload).toMatchObject({ daysLeft: 1 });
    expect(rows[0]!.dedupeKey).toMatch(/:2026-10-17$/);
  });

  it('counts days correctly across the DST change and month ends', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    await addTask({ dueDate: '2026-10-27' });
    await recordDeadlineReminders(deps, new Date('2026-10-24T07:00:00Z')); // day 10-24, 3 days
    await addTask({ dueDate: '2026-11-01' });
    await recordDeadlineReminders(deps, new Date('2026-10-30T08:00:00Z')); // day 10-30, 2 days
    const days = (await events('task.deadline')).map(
      (r) => (r.payload as { daysLeft: number }).daysLeft,
    );
    expect(days.sort()).toEqual([2, 3]);
  });

  it('records nothing for a task without assignees and returns the count', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    await addTask({ dueDate: '2026-10-18', assignees: [] });
    await recordDeadlineReminders(deps, now);
    expect(await events('task.deadline')).toHaveLength(0);
  });

  it('reaches every assignee', async () => {
    const { assignee, addTask, events } = await setup();
    const other = await createUnverifiedClient(db, `${randomUUID()}@example.com`);
    const { deps } = makeDeps();
    await addTask({ dueDate: '2026-10-18', assignees: [assignee.id, other.id] });
    await recordDeadlineReminders(deps, now);
    expect(await events('task.deadline', [assignee.id, other.id])).toHaveLength(2);
  });
});

describe('recordUrgentReminders', () => {
  it('reminds for urgent open tasks only', async () => {
    const { group, assignee, addTask, events } = await setup();
    const { deps, send } = makeDeps();
    const urgent = await addTask({ urgent: true });
    await addTask({ urgent: false });
    await addTask({ urgent: true, done: true });
    await recordUrgentReminders(deps, new Date('2026-10-16T06:00:00Z')); // 08:00
    const rows = await events('task.urgent');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: assignee.id,
      groupId: group.id,
      payload: { taskId: urgent, groupId: group.id, title: expect.any(String) },
      dedupeKey: `urgent:${urgent}:2026-10-16T08`,
    });
    expect(send).toHaveBeenCalledWith('notifications.deliver', {
      userIds: expect.arrayContaining([assignee.id]),
    });
  });

  it('records nothing without assignees', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    await addTask({ urgent: true, assignees: [] });
    expect(
      await recordUrgentReminders(deps, new Date('2026-10-16T06:00:00Z')),
    ).toBeGreaterThanOrEqual(0);
    expect(await events('task.urgent')).toHaveLength(0);
  });

  it('urgent slot key follows Bratislava hour across DST', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    const id = await addTask({ urgent: true });
    // 2026-10-25: the clocks went back at 01:00 UTC, so 19:00Z is 20:00 and 16:00Z is 17:00.
    const t20 = new Date('2026-10-25T19:00:00Z');
    await recordUrgentReminders(deps, t20);
    await recordUrgentReminders(deps, new Date('2026-10-25T19:02:00Z'));
    expect(await events('task.urgent')).toHaveLength(1);
    await recordUrgentReminders(deps, new Date('2026-10-25T16:00:00Z'));
    const keys = (await events('task.urgent')).map((r) => r.dedupeKey).sort();
    expect(keys).toEqual([`urgent:${id}:2026-10-25T17`, `urgent:${id}:2026-10-25T20`]);
  });

  it('urgent slot key at the spring change', async () => {
    const { addTask, events } = await setup();
    const { deps } = makeDeps();
    const id = await addTask({ urgent: true });
    // 2026-03-29: the clocks went forward; 06:00Z is already 08:00 (CEST).
    await recordUrgentReminders(deps, new Date('2026-03-29T06:00:00Z'));
    expect((await events('task.urgent')).map((r) => r.dedupeKey)).toEqual([
      `urgent:${id}:2026-03-29T08`,
    ]);
  });
});
