import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import type { FakePushSender } from '../../infra/push/index.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { buildTestApp } from '../../../test/test-app.js';
import { groupMembers } from '../groups/schema.js';
import { addMember, createGroup } from '../groups/service.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { createItem } from '../knowledge/service.js';
import { deliverPending } from '../notifications/deliver.js';
import { setGroupMode } from '../notifications/modes.js';
import { saveSubscription } from '../notifications/push-subscriptions.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { fireBatch, fireDueReminders } from './jobs.js';
import { reminderSets, reminderTimes } from './schema.js';
import { sql } from 'drizzle-orm';
import type { Server as SocketIOServer } from 'socket.io';
import { RemindersEvents } from '@spolu/shared';
import { groupRoom } from '../../infra/realtime/rooms.js';
import { insertTask } from '../../../test/tasks.js';
import { tasks } from '../tasks/schema.js';
import { attachRemindersRealtime } from './realtime.js';
import { replaceReminderSet } from './service.js';

let deps: AppDeps;
let push: FakePushSender;
let close: () => Promise<void>;
const admins: string[] = [];
beforeAll(async () => {
  ({ deps, push, close } = await buildTestApp({
    config: { push: { provider: 'fake' } } as never,
  }));
});
afterAll(async () => {
  for (const id of admins) await deactivateUser(deps.db, id);
  await close();
});

const HOUR = 60 * 60_000;

async function newAdmin(): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const row = await addAdmin(deps.db, { email, name: 'Ada' });
  admins.push(row.id);
  return { id: row.id, email, name: 'Ada', role: 'admin', finance: false };
}

async function newClient(groupId: string): Promise<SessionUser> {
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await deps.db
    .insert(user)
    .values({ id, email, name: 'Cleo', role: 'client', emailVerified: true, language: 'en' });
  await addMember(deps.db, groupId, id);
  await saveSubscription(deps.db, id, {
    endpoint: `https://push.example.test/${randomUUID()}`,
    p256dh: 'pk',
    auth: 'au',
    userAgent: null,
  });
  return { id, email, name: 'Cleo', role: 'client', finance: false };
}

/** A reminder item whose first time is moved into the past by `agoMs`. */
async function setup(opts: { agoMs?: number; extra?: string[] } = {}) {
  const group = await createGroup(deps.db, {
    name: `Firma ${randomUUID().slice(0, 8)}`,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
  const admin = await newAdmin();
  const client = await newClient(group.id);
  const { item } = await createItem({ db: deps.db }, admin, group.id, {
    type: 'reminder',
    title: 'Renew contract',
    body: '',
    visibility: 'public',
    fileIds: [],
    reminder: {
      times: [{ at: new Date(Date.now() + 2 * HOUR).toISOString() }],
      recipientIds: [client.id, ...(opts.extra ?? [])],
    },
  });
  const [set] = await deps.db
    .select()
    .from(reminderSets)
    .where(eq(reminderSets.knowledgeItemId, item.id));
  const [time] = await deps.db.select().from(reminderTimes).where(eq(reminderTimes.setId, set!.id));
  await deps.db
    .update(reminderTimes)
    .set({ at: new Date(Date.now() - (opts.agoMs ?? 30_000)) })
    .where(eq(reminderTimes.id, time!.id));
  return { group, admin, client, item, setId: set!.id, timeId: time!.id };
}

const eventsOf = (timeId: string) =>
  deps.db
    .select()
    .from(notificationEvents)
    .where(eq(notificationEvents.dedupeKey, `reminder:${timeId}`));

const pushesFor = (itemId: string) => push.sent.filter((p) => p.payload.url.includes(itemId));

const fire = (setId: string) => fireDueReminders(deps, { setIds: [setId] });

describe('reminders.fire', () => {
  it('due times record one event per recipient and set fired_at', async () => {
    const s = await setup();
    expect(await fire(s.setId)).toBe(1);
    const events = await eventsOf(s.timeId);
    expect(events.map((e) => e.userId).sort()).toEqual([s.admin.id, s.client.id].sort());
    expect(events.every((e) => e.kind === 'reminder.due')).toBe(true);
    const [time] = await deps.db.select().from(reminderTimes).where(eq(reminderTimes.id, s.timeId));
    expect(time!.firedAt).not.toBeNull();
  });

  it('a rerun records nothing', async () => {
    const s = await setup();
    await fire(s.setId);
    await deps.db
      .update(reminderTimes)
      .set({ firedAt: null })
      .where(eq(reminderTimes.id, s.timeId));
    await fire(s.setId);
    expect(await eventsOf(s.timeId)).toHaveLength(2);
  });

  it('two workers in parallel never double-fire', async () => {
    const s = await setup();
    const [a, b] = await Promise.all([fire(s.setId), fire(s.setId)]);
    expect(a + b).toBe(1);
    expect(await eventsOf(s.timeId)).toHaveLength(2);
  });

  it('times older than 24 h are marked fired silently', async () => {
    const s = await setup({ agoMs: 25 * HOUR });
    expect(await fire(s.setId)).toBe(1);
    expect(await eventsOf(s.timeId)).toHaveLength(0);
    const [time] = await deps.db.select().from(reminderTimes).where(eq(reminderTimes.id, s.timeId));
    expect(time!.firedAt).not.toBeNull();
  });

  it('a non-admin recipient of an admins-only subject is skipped', async () => {
    // The client subscribed while the item was public; it became admins-only since.
    const s = await setup();
    await deps.db
      .update(knowledgeItems)
      .set({ visibility: 'admins' })
      .where(eq(knowledgeItems.id, s.item.id));
    await fire(s.setId);
    expect((await eventsOf(s.timeId)).map((e) => e.userId)).toEqual([s.admin.id]);
  });

  it('a removed group member gets no push', async () => {
    const s = await setup();
    await deps.db.delete(groupMembers).where(eq(groupMembers.userId, s.client.id));
    await fire(s.setId);
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(pushesFor(s.item.id)).toHaveLength(0);
  });

  it('a recipient in mode Off still gets the push', async () => {
    const s = await setup();
    await setGroupMode(deps.db, s.client.id, s.group.id, 'off');
    await fire(s.setId); // requests delivery, which the inline queue runs for these users
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(pushesFor(s.item.id)).toHaveLength(1);
  });

  it('the push has title · group, Reminder for …, /groups/<g>/knowledge?k=<id>', async () => {
    const s = await setup();
    await fire(s.setId);
    await deliverPending(deps, { userIds: [s.client.id] });
    const sent = pushesFor(s.item.id);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.title).toBe(`Renew contract · ${s.group.name}`);
    expect(sent[0]!.payload.body).toMatch(/^Reminder for /);
    expect(sent[0]!.payload.url).toBe(`/groups/${s.group.id}/knowledge?k=${s.item.id}`);
  });

  it('SKIP LOCKED: a second open transaction skips the times the first has locked', async () => {
    const s = await setup();
    const now = new Date();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let locked!: () => void;
    const aLocked = new Promise<void>((r) => (locked = r));
    const a = deps.db.transaction((tx) =>
      fireBatch(tx, now, 200, [s.setId], async () => {
        locked();
        await gate; // A keeps its transaction open, holding the lock
      }),
    );
    await aLocked;
    const b = await deps.db.transaction((tx) => fireBatch(tx, now, 200, [s.setId]));
    expect(b.count).toBe(0);
    release();
    expect((await a).count).toBe(1);
    expect(await eventsOf(s.timeId)).toHaveLength(2);
  });

  it('a batch of 30 due times takes as many queries as a batch of 2 (Phase 27 S7)', async () => {
    const counting = createCountingDb();
    try {
      const fireCounting = async (n: number) => {
        const s = await setup();
        // n - 1 more due times on the same set, so one batch fires n times.
        await deps.db.insert(reminderTimes).values(
          Array.from({ length: n - 1 }, (_, i) => ({
            id: randomUUID(),
            setId: s.setId,
            at: new Date(Date.now() - (i + 2) * 60_000),
          })),
        );
        counting.reset();
        const batch = await counting.db.transaction((tx) =>
          fireBatch(tx, new Date(), 200, [s.setId]),
        );
        const queries = counting.count();
        expect(batch.count).toBe(n);
        expect(batch.eventIds).toHaveLength(2 * n); // the admin author and the client
        const fired = await deps.db
          .select()
          .from(reminderTimes)
          .where(eq(reminderTimes.setId, s.setId));
        expect(fired.every((t) => t.firedAt !== null)).toBe(true);
        return queries;
      };
      // A statement shape the connection has not seen costs an extra round trip (postgres.js
      // describes it first), so each size runs twice and the second count is compared.
      const warm = async (n: number) => (await fireCounting(n), fireCounting(n));
      expect(await warm(30)).toBe(await warm(2));
    } finally {
      await counting.close();
    }
  });

  it('times whose set has no subject are still marked fired', async () => {
    const s = await setup();
    // The check constraint makes a subject-less set impossible; lift it inside a rolled-back
    // transaction to reach the empty-subjects path.
    const rollback = new Error('rollback');
    await expect(
      deps.db.transaction(async (tx) => {
        await tx.execute(
          sql`alter table reminder_sets drop constraint reminder_sets_subject_check`,
        );
        await tx.execute(
          sql`update reminder_sets set knowledge_item_id = null where id = ${s.setId}`,
        );
        const batch = await fireBatch(tx, new Date(), 200, [s.setId]);
        expect(batch).toMatchObject({ count: 1, eventIds: [] });
        const [time] = await tx.select().from(reminderTimes).where(eq(reminderTimes.id, s.timeId));
        expect(time!.firedAt).not.toBeNull();
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});

describe('reminders.fire with task subjects', () => {
  /** A fake Socket.IO server that records what is emitted to which room. */
  function fakeIo() {
    const emitted: { room: string; event: string; payload: unknown }[] = [];
    const io = {
      to: (room: string) => ({
        emit: (event: string, payload: unknown) => void emitted.push({ room, event, payload }),
      }),
    };
    return { io: io as unknown as SocketIOServer, emitted };
  }

  /** A task by the admin with one custom reminder time, moved `agoMs` into the past. */
  async function taskSetup(opts: { agoMs?: number; done?: boolean } = {}) {
    const group = await createGroup(deps.db, {
      name: `Firma ${randomUUID().slice(0, 8)}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const admin = await newAdmin();
    const client = await newClient(group.id);
    const taskId = await insertTask(deps.db, {
      groupId: group.id,
      createdBy: admin.id,
      title: 'Fix the budget table',
      done: opts.done,
    });
    await deps.db.transaction((tx) =>
      replaceReminderSet(
        tx,
        { kind: 'task', id: taskId, groupId: group.id, adminsOnly: false, authorId: admin.id },
        {
          times: [{ at: new Date(Date.now() + 2 * HOUR).toISOString() }],
          recipientIds: [client.id],
        },
        admin,
      ),
    );
    const [set] = await deps.db.select().from(reminderSets).where(eq(reminderSets.taskId, taskId));
    const [time] = await deps.db
      .select()
      .from(reminderTimes)
      .where(eq(reminderTimes.setId, set!.id));
    await deps.db
      .update(reminderTimes)
      .set({ at: new Date(Date.now() - (opts.agoMs ?? 30_000)) })
      .where(eq(reminderTimes.id, time!.id));
    return { group, admin, client, taskId, setId: set!.id, timeId: time!.id };
  }

  const firedAt = async (timeId: string) =>
    (await deps.db.select().from(reminderTimes).where(eq(reminderTimes.id, timeId)))[0]?.firedAt;
  const taskPushes = (taskId: string) =>
    push.sent.filter((p) => p.payload.tag === `task:${taskId}`);

  it('fires for an open task', async () => {
    const s = await taskSetup();
    expect(await fire(s.setId)).toBe(1);
    const events = await eventsOf(s.timeId);
    expect(events.map((e) => e.userId).sort()).toEqual([s.admin.id, s.client.id].sort());
    expect(events[0]!.payload).toMatchObject({
      subjectKind: 'task',
      subjectId: s.taskId,
      taskId: s.taskId,
      groupId: s.group.id,
    });
    await deliverPending(deps, { userIds: [s.client.id] });
    const sent = taskPushes(s.taskId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.url).toBe(`/groups/${s.group.id}/tasks/${s.taskId}`);
  });

  it('is silent for a task in Completed and sets fired_at', async () => {
    const s = await taskSetup();
    await deps.db.update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, s.taskId));
    expect(await fire(s.setId)).toBe(1);
    expect(await eventsOf(s.timeId)).toHaveLength(0);
    expect(await firedAt(s.timeId)).not.toBeNull();
  });

  it('fires again normally for a task reopened before the time', async () => {
    const s = await taskSetup({ done: true });
    await deps.db.update(tasks).set({ completedAt: null }).where(eq(tasks.id, s.taskId));
    await fire(s.setId);
    expect(await eventsOf(s.timeId)).toHaveLength(2);
  });

  it("a deleted task's times are gone", async () => {
    const s = await taskSetup();
    await deps.db.delete(tasks).where(eq(tasks.id, s.taskId));
    expect(await firedAt(s.timeId)).toBeUndefined();
    expect(await fire(s.setId)).toBe(0);
  });

  it('a task recipient in mode Off still gets the push', async () => {
    const s = await taskSetup();
    await setGroupMode(deps.db, s.client.id, s.group.id, 'off');
    await fire(s.setId);
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(taskPushes(s.taskId)).toHaveLength(1);
  });

  it("a renamed task's reminder push shows the current title", async () => {
    const s = await taskSetup();
    // Record without delivering, rename, then deliver.
    await deps.db.transaction((tx) => fireBatch(tx, new Date(), 200, [s.setId]));
    await deps.db.update(tasks).set({ title: 'Renamed task' }).where(eq(tasks.id, s.taskId));
    await deliverPending(deps, { userIds: [s.client.id] });
    const sent = taskPushes(s.taskId);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.payload.title.startsWith('Renamed task · ')).toBe(true);
  });

  it('firing emits reminders:task with the remaining count', async () => {
    const s = await taskSetup();
    const { io, emitted } = fakeIo();
    attachRemindersRealtime(io);
    try {
      await fire(s.setId);
    } finally {
      attachRemindersRealtime(null);
    }
    expect(emitted).toEqual([
      {
        room: groupRoom(s.group.id),
        event: RemindersEvents.task,
        payload: { groupId: s.group.id, taskId: s.taskId, upcomingReminders: 0 },
      },
    ]);
  });
});
