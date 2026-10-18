import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { HomeWorkload, SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { groups } from '../groups/schema.js';
import { recordNotifications } from '../notifications/service.js';
import { markTaskSeen } from '../notifications/unseen.js';
import { ensureBoard } from '../tasks/service.js';
import { countUnseenTickets } from '../tickets/dashboard.js';
import { ticketAssignees, tickets } from '../tickets/schema.js';
import { deactivateUser } from '../users/service.js';
import { countUnseenTasks } from './assigned.js';
import { newAdmin, newClient, newGroup, newTask } from './test-fixtures.js';
import { bratislavaWeek, getWorkload } from './workload.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
afterAll(async () => {
  await close();
  await counting.close();
});

/** Wednesday 21 October 2026, noon in Bratislava: today is `2026-10-21`. */
const now = new Date('2026-10-21T10:00:00Z');

describe('bratislavaWeek', () => {
  it('is Monday to the next Monday', () => {
    expect(bratislavaWeek(new Date('2026-10-21T10:00:00Z'))).toEqual({
      from: '2026-10-19',
      until: '2026-10-26',
    });
  });
  it('a Sunday belongs to the week that started six days before', () => {
    expect(bratislavaWeek(new Date('2026-10-25T12:00:00Z'))).toEqual({
      from: '2026-10-19',
      until: '2026-10-26',
    });
  });
  it('follows Bratislava, not UTC, around midnight', () => {
    // 23:30 UTC on Sunday 25 Oct is 00:30 on Monday 26 Oct in Bratislava (CET after the DST end).
    expect(bratislavaWeek(new Date('2026-10-25T23:30:00Z'))).toEqual({
      from: '2026-10-26',
      until: '2026-11-02',
    });
  });
});

async function newTicket(input: {
  groupId: string | null;
  status?: 'new' | 'in_progress' | 'resolved';
  assigneeIds?: string[];
}) {
  const id = randomUUID();
  await db.insert(tickets).values({
    id,
    groupId: input.groupId,
    status: input.status ?? 'new',
    source: 'manual',
    subject: 'T',
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  const assignees = input.assigneeIds ?? [];
  if (assignees.length > 0) {
    await db.insert(ticketAssignees).values(assignees.map((userId) => ({ ticketId: id, userId })));
  }
  return id;
}

/**
 * The test database is shared by every test file (and holds hundreds of admins during a run), so
 * each test reads only its own admins: `admins` restricts the statement to them (a test seam; the
 * route reads every active admin).
 */
async function workload(viewer: SessionUser, admins: string[], deps = {}): Promise<HomeWorkload> {
  return getWorkload(db, viewer, now, { admins, ...deps });
}

const rowOf = (answer: HomeWorkload, id: string) => {
  const row = answer.admins.find((a) => a.userId === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
};

const counts = (row: {
  openTasks: number;
  overdueTasks: number;
  openTickets: number;
  unseen: number;
}) => ({
  openTasks: row.openTasks,
  overdueTasks: row.overdueTasks,
  openTickets: row.openTickets,
  unseen: row.unseen,
});

describe('getWorkload', () => {
  it('counts open assigned tasks per admin and client, completed ones not', async () => {
    const [g1, g2] = await Promise.all([newGroup(db, 'W G1'), newGroup(db, 'W G2')]);
    const a = await newAdmin(db, 'Ada');
    for (let i = 0; i < 2; i++) {
      await newTask(db, { groupId: g1.id, createdBy: a.id, assigneeIds: [a.id] });
    }
    await newTask(db, { groupId: g2.id, createdBy: a.id, assigneeIds: [a.id] });
    await newTask(db, {
      groupId: g1.id,
      createdBy: a.id,
      assigneeIds: [a.id],
      completedAt: new Date(),
    });
    const row = rowOf(await workload(a, [a.id]), a.id);
    expect(row.openTasks).toBe(3);
    expect(row.clients.map((c) => [c.groupId, c.openTasks])).toEqual([
      [g1.id, 2],
      [g2.id, 1],
    ]);
  });

  it('counts overdue as a due date before the Bratislava today', async () => {
    const g = await newGroup(db, 'W due');
    const a = await newAdmin(db, 'Ada');
    for (const dueDate of ['2026-10-20', '2026-10-21', null]) {
      await newTask(db, { groupId: g.id, createdBy: a.id, assigneeIds: [a.id], dueDate });
    }
    const answer = await workload(a, [a.id]);
    expect(answer.today).toBe('2026-10-21');
    expect(rowOf(answer, a.id)).toMatchObject({ openTasks: 3, overdueTasks: 1 });
  });

  it('counts active tickets the admin is a riešiteľ of', async () => {
    const g = await newGroup(db, 'W tickets');
    const a = await newAdmin(db, 'Ada');
    await newTicket({ groupId: g.id, status: 'new', assigneeIds: [a.id] });
    await newTicket({ groupId: g.id, status: 'in_progress', assigneeIds: [a.id] });
    await newTicket({ groupId: g.id, status: 'resolved', assigneeIds: [a.id] });
    await newTicket({ groupId: g.id, status: 'new' });
    const row = rowOf(await workload(a, [a.id]), a.id);
    expect(row.openTickets).toBe(2);
    expect(row.clients).toMatchObject([{ groupId: g.id, openTickets: 2, openTasks: 0 }]);
  });

  it('puts tickets without a client in a "Bez klienta" row', async () => {
    const a = await newAdmin(db, 'Ada');
    await newTicket({ groupId: null, status: 'new', assigneeIds: [a.id] });
    const row = rowOf(await workload(a, [a.id]), a.id);
    expect(row.clients).toEqual([
      {
        groupId: null,
        name: null,
        internal: false,
        openTasks: 0,
        overdueTasks: 0,
        openTickets: 1,
        unseen: 0,
      },
    ]);
  });

  it('leaves out deactivated groups everywhere', async () => {
    const [g1, g3] = await Promise.all([newGroup(db, 'W live'), newGroup(db, 'W gone')]);
    const a = await newAdmin(db, 'Ada');
    await newTask(db, { groupId: g1.id, createdBy: a.id, assigneeIds: [a.id] });
    const goneTask = await newTask(db, { groupId: g3.id, createdBy: a.id, assigneeIds: [a.id] });
    await newTicket({ groupId: g3.id, assigneeIds: [a.id] });
    await recordNotifications(db, {
      kind: 'task.moved',
      groupId: g3.id,
      recipients: [a.id],
      payload: { taskId: goneTask, groupId: g3.id },
    });
    await db.update(groups).set({ deactivatedAt: new Date() }).where(eq(groups.id, g3.id));
    const row = rowOf(await workload(a, [a.id]), a.id);
    expect(counts(row)).toEqual({ openTasks: 1, overdueTasks: 0, openTickets: 0, unseen: 0 });
    expect(row.clients.map((c) => c.groupId)).toEqual([g1.id]);
  });

  it('marks the admin group as internal and counts it', async () => {
    const adminGroup = await ensureAdminGroup(db);
    await ensureBoard(db, adminGroup);
    const a = await newAdmin(db, 'Ada');
    await newTask(db, { groupId: adminGroup, createdBy: a.id, assigneeIds: [a.id] });
    const row = rowOf(await workload(a, [a.id]), a.id);
    expect(row.clients).toMatchObject([{ groupId: adminGroup, internal: true, openTasks: 1 }]);
  });

  it('lists every active admin, one with no work with zeros, and no disabled admin or client', async () => {
    const g = await newGroup(db, 'W people');
    const a = await newAdmin(db, 'Ada');
    const e = await newAdmin(db, 'Ema');
    const d = await newAdmin(db, 'Dan');
    const client = await newClient(db, g.id);
    await newTask(db, { groupId: g.id, createdBy: a.id, assigneeIds: [a.id, d.id, client.id] });
    await deactivateUser(db, d.id);
    const answer = await workload(a, [a.id, e.id, d.id, client.id]);
    expect(answer.admins.map((r) => r.userId)).toEqual([a.id, e.id]);
    expect(rowOf(answer, e.id)).toEqual({
      userId: e.id,
      name: 'Ema',
      self: false,
      openTasks: 0,
      overdueTasks: 0,
      openTickets: 0,
      unseen: 0,
      clients: [],
      moreClients: null,
    });
  });

  it('counts unseen tasks and tickets per admin as their header does', async () => {
    const g = await newGroup(db, 'W unseen');
    const a = await newAdmin(db, 'Ada');
    const taskId = await newTask(db, { groupId: g.id, createdBy: a.id });
    const ticketId = await newTicket({ groupId: g.id });
    await recordNotifications(db, {
      kind: 'task.assigned',
      groupId: g.id,
      recipients: [a.id],
      payload: { taskId, groupId: g.id },
    });
    await recordNotifications(db, {
      kind: 'ticket.status',
      groupId: g.id,
      recipients: [a.id],
      payload: { ticketId },
    });
    const header = async () =>
      (await countUnseenTasks(db, a.id)) + (await countUnseenTickets(db, a.id));
    let row = rowOf(await workload(a, [a.id]), a.id);
    expect(row.unseen).toBe(2);
    expect(row.unseen).toBe(await header());
    expect(row.clients).toMatchObject([{ groupId: g.id, unseen: 2, openTasks: 0 }]);
    await markTaskSeen(db, a.id, taskId);
    row = rowOf(await workload(a, [a.id]), a.id);
    expect(row.unseen).toBe(1);
    expect(row.unseen).toBe(await header());
  });

  it('orders admins and clients by load, then overdue, then name', async () => {
    const [gx, gy] = await Promise.all([newGroup(db, 'W order X'), newGroup(db, 'W order Y')]);
    const a = await newAdmin(db, 'Ada');
    const b = await newAdmin(db, 'Bea');
    const c = await newAdmin(db, 'Cyd');
    for (let i = 0; i < 5; i++) {
      await newTask(db, { groupId: gx.id, createdBy: a.id, assigneeIds: [b.id] });
      await newTask(db, {
        groupId: i < 3 ? gx.id : gy.id,
        createdBy: a.id,
        assigneeIds: [c.id],
        dueDate: i === 4 ? '2026-10-01' : null,
      });
    }
    await newTask(db, { groupId: gx.id, createdBy: a.id, assigneeIds: [a.id] });
    const answer = await workload(a, [a.id, b.id, c.id]);
    expect(answer.admins.map((r) => r.userId)).toEqual([c.id, b.id, a.id]);
    // C: X has 3, Y has 2 (one overdue).
    expect(rowOf(answer, c.id).clients.map((r) => r.groupId)).toEqual([gx.id, gy.id]);
    // Equal loads: the overdue one first, then by name.
    const d = await newAdmin(db, 'Dot');
    await newTask(db, { groupId: gx.id, createdBy: a.id, assigneeIds: [d.id] });
    await newTask(db, {
      groupId: gy.id,
      createdBy: a.id,
      assigneeIds: [d.id],
      dueDate: '2026-10-01',
    });
    const e = await newAdmin(db, 'Eli');
    await newTask(db, { groupId: gy.id, createdBy: a.id, assigneeIds: [e.id] });
    await newTask(db, { groupId: gx.id, createdBy: a.id, assigneeIds: [e.id] });
    const next = await workload(a, [d.id, e.id]);
    expect(rowOf(next, d.id).clients.map((r) => r.groupId)).toEqual([gy.id, gx.id]);
    expect(rowOf(next, e.id).clients.map((r) => r.name)).toEqual(['W order X', 'W order Y']);
  });

  it('caps the breakdown at 20 clients and sums the rest', async () => {
    const a = await newAdmin(db, 'Ada');
    const many = [];
    for (let i = 0; i < 23; i++)
      many.push(await newGroup(db, `W cap ${String(i).padStart(2, '0')}`));
    for (const [i, g] of many.entries()) {
      await newTask(db, { groupId: g.id, createdBy: a.id, assigneeIds: [a.id] });
      if (i === 0) await newTask(db, { groupId: g.id, createdBy: a.id, assigneeIds: [a.id] });
    }
    const row = rowOf(await workload(a, [a.id]), a.id);
    expect(row.openTasks).toBe(24);
    expect(row.clients).toHaveLength(20);
    expect(row.clients[0]).toMatchObject({ groupId: many[0]!.id, openTasks: 2 });
    expect(row.moreClients).toEqual({
      count: 3,
      openTasks: 3,
      overdueTasks: 0,
      openTickets: 0,
      unseen: 0,
    });
  });

  it("marks the viewer's own row", async () => {
    const a = await newAdmin(db, 'Ada');
    const b = await newAdmin(db, 'Bea');
    const answer = await workload(a, [a.id, b.id]);
    expect(answer.admins.map((r) => [r.userId, r.self])).toEqual([
      [a.id, true],
      [b.id, false],
    ]);
  });

  it('adds minutes only for a finance holder', async () => {
    const a = await newAdmin(db, 'Ada');
    const b = await newAdmin(db, 'Bea');
    const weekMinutes = vi.fn(async () => new Map([[a.id, 90]]));
    const superadmin = { ...a, role: 'superadmin', finance: true } as SessionUser;
    const finance = await workload(superadmin, [a.id, b.id], { weekMinutes });
    expect(finance.week).toEqual({ from: '2026-10-19', until: '2026-10-26' });
    expect(rowOf(finance, a.id).minutesThisWeek).toBe(90);
    expect(rowOf(finance, b.id).minutesThisWeek).toBe(0);
    expect(weekMinutes).toHaveBeenCalledWith(db, [a.id, b.id], finance.week);

    weekMinutes.mockClear();
    const plain = await workload({ ...a, finance: false }, [a.id, b.id], { weekMinutes });
    expect(plain.week).toBeNull();
    expect(plain.admins.every((r) => !('minutesThisWeek' in r))).toBe(true);
    expect(weekMinutes).not.toHaveBeenCalled();
  });

  it('runs one statement for a plain admin and two for a finance holder', async () => {
    const a = await newAdmin(db, 'Ada');
    const g = await newGroup(db, 'W count');
    await newTask(db, { groupId: g.id, createdBy: a.id, assigneeIds: [a.id] });
    const plain = { ...a, finance: false };
    const finance = { ...a, finance: true };
    const measure = async (viewer: SessionUser, admins: string[]) => {
      // A new connection first reads the types: warm it up so the count sees only the queries.
      await counting.db.execute(sql`select 1`);
      counting.reset();
      await getWorkload(counting.db, viewer, now, { admins });
      return counting.count();
    };
    expect(await measure(plain, [a.id])).toBe(1);
    expect(await measure(finance, [a.id])).toBe(2);
    const more = [];
    for (let i = 0; i < 3; i++) {
      const other = await newAdmin(db, `More ${i}`);
      const og = await newGroup(db, `W count ${i}`);
      await newTask(db, { groupId: og.id, createdBy: a.id, assigneeIds: [other.id] });
      more.push(other.id);
    }
    expect(await measure(plain, [a.id, ...more])).toBe(1);
    expect(await measure(finance, [a.id, ...more])).toBe(2);
  });
});
