import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { unreadByGroup } from '../chat/service.js';
import { setDefaultMode, setGroupMode } from '../notifications/modes.js';
import { recordNotifications } from '../notifications/service.js';
import { markTaskSeen, markTicketSeen } from '../notifications/unseen.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { setNotificationChannel } from '../users/service.js';
import { getSidebar } from './sidebar.js';
import { bucketOf, newAdmin, newClient, newGroup, newMessage, newTask } from './test-fixtures.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

/**
 * Six groups: managed (M) and other (O), each with nothing, a task with an unseen change (the
 * "assigned" ones, 2026-10-17) or an unread message.
 */
async function setup() {
  const names = ['M nothing', 'M assigned', 'M unread', 'O unread', 'O nothing', 'O assigned'];
  const [mNothing, mAssigned, mUnread, oUnread, oNothing, oAssigned] = await Promise.all(
    names.map((name) => newGroup(db, name)),
  );
  const admin = await newAdmin(db, 'Ada', [mNothing!.id, mAssigned!.id, mUnread!.id]);
  for (const g of [mUnread!, oUnread!]) {
    const client = await newClient(db, g.id);
    await newMessage(db, { channelId: g.channelId, authorId: client.id });
  }
  for (const g of [mAssigned!, oAssigned!]) {
    const taskId = await newTask(db, {
      groupId: g.id,
      createdBy: admin.id,
      assigneeIds: [admin.id],
    });
    await moved(admin.id, g.id, taskId);
  }
  const all = { mNothing, mAssigned, mUnread, oUnread, oNothing, oAssigned };
  return { admin, groups: all as { [K in keyof typeof all]: NonNullable<(typeof all)[K]> } };
}

function moved(userId: string, groupId: string, taskId: string) {
  return recordNotifications(db, {
    kind: 'task.moved',
    groupId,
    recipients: [userId],
    payload: { taskId, groupId },
  });
}

const own = (rows: Awaited<ReturnType<typeof getSidebar>>, ids: string[]) =>
  rows.filter((r) => ids.includes(r.groupId));

describe('getSidebar', () => {
  it('managed first, then others', async () => {
    const { admin, groups } = await setup();
    const ids = Object.values(groups).map((g) => g.id);
    const rows = own(await getSidebar(db, admin.id), ids);
    expect(rows.map((r) => r.managed)).toEqual([true, true, true, false, false, false]);
    // The admin group's internal section comes first (Phase 34, admin-group.test.ts).
    const all = (await getSidebar(db, admin.id)).filter((r) => r.section === 'client');
    const firstOther = all.findIndex((r) => !r.managed);
    expect(all.slice(firstOther).every((r) => !r.managed)).toBe(true);
  });

  it('inside a section: a badge first, then the rest, by name', async () => {
    const { admin, groups: g } = await setup();
    const ids = Object.values(g).map((x) => x.id);
    const rows = own(await getSidebar(db, admin.id), ids);
    expect(rows.map((r) => r.groupId)).toEqual([
      g.mAssigned.id,
      g.mUnread.id,
      g.mNothing.id,
      g.oAssigned.id,
      g.oUnread.id,
      g.oNothing.id,
    ]);
    expect(rows[1]).toMatchObject({
      name: 'M unread',
      hasLogo: false,
      unread: 1,
      unseenTasks: 0,
      unseenTickets: 0,
    });
    expect(rows[0]).toMatchObject({ name: 'M assigned', unread: 0, unseenTasks: 1 });
    expect(typeof rows[0]!.updatedAt).toBe('string');
  });

  it('with group ids: only those rows, with the same values as the full list', async () => {
    const { admin, groups: g } = await setup();
    const ids = Object.values(g).map((x) => x.id);
    const full = own(await getSidebar(db, admin.id), ids);
    const pick = [g.mAssigned.id, g.oUnread.id, g.oNothing.id];
    const part = await getSidebar(db, admin.id, pick);
    expect(part).toEqual(full.filter((r) => pick.includes(r.groupId)));
    expect(await getSidebar(db, admin.id, [])).toEqual([]);
  });

  it('unread equals unreadByGroup for each group', async () => {
    const { admin, groups } = await setup();
    // Only this test's groups: other test files write messages to other groups meanwhile.
    const ids = Object.values(groups).map((g) => g.id);
    const rows = own(await getSidebar(db, admin.id), ids);
    const expected = await unreadByGroup(db, admin.id, null);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row.unread).toBe(expected[row.groupId] ?? 0);
  });

  describe('only groups whose chat notifies (the dashboard follows the notification settings)', () => {
    const unread = async (adminId: string, groupId: string) =>
      own(await getSidebar(db, adminId), [groupId])[0]!.unread;

    it('a group on Off counts 0; Mentions and replies still counts every unread message', async () => {
      const { admin, groups: g } = await setup();
      expect(await unread(admin.id, g.mUnread.id)).toBe(1);
      await setGroupMode(db, admin.id, g.mUnread.id, 'off');
      expect(await unread(admin.id, g.mUnread.id)).toBe(0);
      // Off only for that group: the other unread group still counts.
      expect(await unread(admin.id, g.oUnread.id)).toBe(1);
      await setGroupMode(db, admin.id, g.mUnread.id, 'mentions');
      expect(await unread(admin.id, g.mUnread.id)).toBe(1);
    });

    it('a default of Off counts 0 except where the group has its own mode', async () => {
      const { admin, groups: g } = await setup();
      await setDefaultMode(db, admin.id, 'off');
      expect(await unread(admin.id, g.mUnread.id)).toBe(0);
      expect(await unread(admin.id, g.oUnread.id)).toBe(0);
      await setGroupMode(db, admin.id, g.oUnread.id, 'all');
      expect(await unread(admin.id, g.oUnread.id)).toBe(1);
    });

    it('chat None counts 0 everywhere; the off group sorts as having nothing unread', async () => {
      const { admin, groups: g } = await setup();
      await setNotificationChannel(db, admin.id, 'chat', 'none');
      const rows = own(
        await getSidebar(db, admin.id),
        Object.values(g).map((x) => x.id),
      );
      expect(rows.every((r) => r.unread === 0)).toBe(true);
      // Managed: the unseen task first, then the rest by name (M nothing, M unread).
      expect(rows.slice(0, 3).map((r) => r.groupId)).toEqual([
        g.mAssigned.id,
        g.mNothing.id,
        g.mUnread.id,
      ]);
      await setNotificationChannel(db, admin.id, 'chat', 'email');
      expect(await unread(admin.id, g.mUnread.id)).toBe(1);
    });
  });

  it('the badge parts: the tasks and tickets of the group with a change I have not seen', async () => {
    const g = await newGroup(db, 'Unseen parts');
    const admin = await newAdmin(db, 'Ada', [g.id]);
    const other = await newAdmin(db, 'Bob', [g.id]);
    const done = await bucketOf(db, g.id, 'done');
    const open = await newTask(db, { groupId: g.id, createdBy: other.id });
    const completed = await newTask(db, {
      groupId: g.id,
      createdBy: other.id,
      bucketId: done,
      completedAt: new Date(),
    });
    await newTask(db, { groupId: g.id, createdBy: other.id, assigneeIds: [admin.id] });
    await moved(admin.id, g.id, open);
    await moved(admin.id, g.id, open);
    await moved(admin.id, g.id, completed);
    await moved(other.id, g.id, open);
    const ticket = randomUUID();
    const now = new Date();
    await db.insert(tickets).values({
      id: ticket,
      groupId: g.id,
      status: 'resolved',
      source: 'manual',
      subject: 'T',
      createdAt: now,
      updatedAt: now,
    });
    await recordNotifications(db, {
      kind: 'ticket.status',
      groupId: g.id,
      recipients: [admin.id],
      payload: { ticketId: ticket, groupId: g.id },
    });
    const row = async () => own(await getSidebar(db, admin.id), [g.id])[0]!;
    expect(await row()).toMatchObject({ unread: 0, unseenTasks: 2, unseenTickets: 1 });
    await markTaskSeen(db, admin.id, open);
    await markTicketSeen(db, admin.id, ticket);
    expect(await row()).toMatchObject({ unseenTasks: 1, unseenTickets: 0 });
  });

  it("a disabled manager's group is under Other clients", async () => {
    const g = await newGroup(db, 'Disabled');
    const b = await newAdmin(db, 'Bob', [g.id]);
    expect(own(await getSidebar(db, b.id), [g.id])[0]!.managed).toBe(true);
    await db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, b.id));
    try {
      expect(own(await getSidebar(db, b.id), [g.id])[0]!.managed).toBe(false);
    } finally {
      await db.update(user).set({ disabledAt: null }).where(eq(user.id, b.id));
    }
  });

  it('one statement', async () => {
    const { admin } = await setup();
    const client = postgres(testDatabaseUrl, { max: 1 });
    let statements = 0;
    const counted = drizzle(client, { logger: { logQuery: () => void statements++ } });
    try {
      await getSidebar(counted, admin.id);
      expect(statements).toBe(1);
    } finally {
      await client.end({ timeout: 1 });
    }
  });
});
