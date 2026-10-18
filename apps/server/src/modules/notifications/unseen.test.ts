import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { NotificationKind, UnseenMark } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { bucketOf, newAdmin, newGroup, newTask } from '../home/test-fixtures.js';
import { tickets } from '../tickets/schema.js';
import { setNotificationChannel } from '../users/service.js';
import { setDefaultMode, setGroupMode } from './modes.js';
import { recordNotifications } from './service.js';
import {
  clearTicketUnseenForAdmins,
  markTaskSeen,
  markTicketSeen,
  taskUnseenSql,
  taskUnseenSummary,
  ticketUnseenSql,
  ticketUnseenSummary,
  unseenTaskIdsSql,
  unseenTicketIdsSql,
} from './unseen.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

async function newTicket(groupId: string | null) {
  const id = randomUUID();
  const now = new Date();
  await db.insert(tickets).values({
    id,
    groupId,
    status: 'new',
    source: 'manual',
    subject: 'T',
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

const taskEvent = (
  kind: NotificationKind,
  userId: string,
  groupId: string,
  taskId: string | null,
  extra: Record<string, unknown> = {},
) =>
  recordNotifications(db, {
    kind,
    groupId,
    recipients: [userId],
    payload: { taskId, groupId, ...extra },
  });

const ticketEvent = (
  kind: NotificationKind,
  userId: string,
  groupId: string | null,
  ticketId: string,
  extra: Record<string, unknown> = {},
) =>
  recordNotifications(db, {
    kind,
    groupId,
    recipients: [userId],
    payload: { ticketId, groupId, ...extra },
  });

/**
 * How the task is marked, asked both ways (the per-row fragment and the id list), which must
 * agree.
 */
async function taskMark(userId: string, taskId: string): Promise<UnseenMark | null> {
  const [row] = [
    ...(await db.execute<{ mark: UnseenMark | null }>(
      sql`select ${taskUnseenSql(userId, sql`${taskId}::text`)} as mark`,
    )),
  ];
  const listed = [
    ...(await db.execute<{ task_id: string; message: boolean }>(unseenTaskIdsSql(userId))),
  ].find((r) => r.task_id === taskId);
  expect(listed ? (listed.message ? 'message' : 'change') : null).toBe(row!.mark);
  return row!.mark;
}

async function ticketMark(userId: string, ticketId: string): Promise<UnseenMark | null> {
  const [row] = [
    ...(await db.execute<{ mark: UnseenMark | null }>(
      sql`select ${ticketUnseenSql(userId, sql`${ticketId}::text`)} as mark`,
    )),
  ];
  const listed = [
    ...(await db.execute<{ ticket_id: string; message: boolean }>(unseenTicketIdsSql(userId))),
  ].find((r) => r.ticket_id === ticketId);
  expect(listed ? (listed.message ? 'message' : 'change') : null).toBe(row!.mark);
  return row!.mark;
}

const taskUnseen = async (userId: string, taskId: string) =>
  (await taskMark(userId, taskId)) !== null;
const ticketUnseen = async (userId: string, ticketId: string) =>
  (await ticketMark(userId, ticketId)) !== null;

async function setup() {
  const group = await newGroup(db, 'Unseen');
  const me = await newAdmin(db, 'Ada', [group.id]);
  const task = await newTask(db, { groupId: group.id, createdBy: me.id, assigneeIds: [me.id] });
  return { group, me, task };
}

describe('unseen changes of a task', () => {
  it('a counted event makes it unseen until the user opens it; a later one again', async () => {
    const { group, me, task } = await setup();
    expect(await taskUnseen(me.id, task)).toBe(false);
    await taskEvent('task.moved', me.id, group.id, task);
    expect(await taskUnseen(me.id, task)).toBe(true);
    await markTaskSeen(db, me.id, task);
    expect(await taskUnseen(me.id, task)).toBe(false);
    await taskEvent('task.assigned', me.id, group.id, task);
    expect(await taskUnseen(me.id, task)).toBe(true);
    await markTaskSeen(db, me.id, task);
    expect(await taskUnseen(me.id, task)).toBe(false);
  });

  it('counts task.assigned, task.moved, task.deadline and the task chat kinds', async () => {
    for (const kind of [
      'task.assigned',
      'task.moved',
      'task.deadline',
      'chat.message',
      'chat.mention',
      'chat.thread_reply',
    ] as const) {
      const { group, me, task } = await setup();
      await setGroupMode(db, me.id, group.id, 'all');
      await taskEvent(kind, me.id, group.id, task);
      expect({ kind, unseen: await taskUnseen(me.id, task) }).toEqual({ kind, unseen: true });
    }
  });

  it('does not count task.urgent, reminder.due, a time request or a group chat message', async () => {
    const { group, me, task } = await setup();
    await setGroupMode(db, me.id, group.id, 'all');
    await taskEvent('task.urgent', me.id, group.id, task);
    await taskEvent('reminder.due', me.id, group.id, task);
    await taskEvent('task.time_missing', me.id, group.id, task);
    await taskEvent('chat.message', me.id, group.id, null);
    expect(await taskUnseen(me.id, task)).toBe(false);
  });

  it("another user's events and another task's do not count", async () => {
    const { group, me, task } = await setup();
    const other = await newAdmin(db, 'Bob');
    const second = await newTask(db, { groupId: group.id, createdBy: me.id });
    await taskEvent('task.moved', other.id, group.id, task);
    await taskEvent('task.moved', me.id, group.id, second);
    expect(await taskUnseen(me.id, task)).toBe(false);
    expect(await taskUnseen(me.id, second)).toBe(true);
    expect(await taskUnseen(other.id, task)).toBe(true);
  });

  it('a completed task still counts until opened', async () => {
    const { group, me } = await setup();
    const done = await newTask(db, {
      groupId: group.id,
      createdBy: me.id,
      bucketId: await bucketOf(db, group.id, 'done'),
      completedAt: new Date(),
    });
    await taskEvent('task.moved', me.id, group.id, done);
    expect(await taskUnseen(me.id, done)).toBe(true);
  });

  it('follows the mode: Off hides everything, Mentions and replies hides a plain message', async () => {
    const { group, me, task } = await setup();
    await setGroupMode(db, me.id, group.id, 'mentions');
    await taskEvent('chat.message', me.id, group.id, task);
    expect(await taskUnseen(me.id, task)).toBe(false);
    await setGroupMode(db, me.id, group.id, 'all');
    expect(await taskUnseen(me.id, task)).toBe(true);
    await setGroupMode(db, me.id, group.id, 'mentions');
    await taskEvent('task.moved', me.id, group.id, task);
    expect(await taskUnseen(me.id, task)).toBe(true);
    await setGroupMode(db, me.id, group.id, 'off');
    expect(await taskUnseen(me.id, task)).toBe(false);
  });

  it('a default of Off hides it unless the group has its own mode', async () => {
    const { group, me, task } = await setup();
    await taskEvent('task.moved', me.id, group.id, task);
    await setDefaultMode(db, me.id, 'off');
    expect(await taskUnseen(me.id, task)).toBe(false);
    await setGroupMode(db, me.id, group.id, 'mentions');
    expect(await taskUnseen(me.id, task)).toBe(true);
  });

  it('a tasks channel of None records nothing and hides what was recorded', async () => {
    const { group, me, task } = await setup();
    await taskEvent('task.moved', me.id, group.id, task);
    await setNotificationChannel(db, me.id, 'tasks', 'none');
    expect(await taskUnseen(me.id, task)).toBe(false);
    await setNotificationChannel(db, me.id, 'tasks', 'email');
    expect(await taskUnseen(me.id, task)).toBe(true);
    await markTaskSeen(db, me.id, task);
    await setNotificationChannel(db, me.id, 'tasks', 'none');
    await taskEvent('task.moved', me.id, group.id, task);
    await setNotificationChannel(db, me.id, 'tasks', 'email');
    expect(await taskUnseen(me.id, task)).toBe(false);
  });

  it('a message in the task chat marks it with a ring until seen; a later move a dot', async () => {
    const { group, me, task } = await setup();
    await setGroupMode(db, me.id, group.id, 'all');
    await taskEvent('task.moved', me.id, group.id, task);
    expect(await taskMark(me.id, task)).toBe('change');
    for (const kind of ['chat.message', 'chat.mention', 'chat.thread_reply'] as const) {
      await taskEvent(kind, me.id, group.id, task);
      expect({ kind, mark: await taskMark(me.id, task) }).toEqual({ kind, mark: 'message' });
      await markTaskSeen(db, me.id, task);
      expect(await taskMark(me.id, task)).toBe(null);
      await taskEvent('task.moved', me.id, group.id, task);
      expect(await taskMark(me.id, task)).toBe('change');
    }
  });

  it('a deleted task is gone from the seen marks (cascade)', async () => {
    const { me, task } = await setup();
    await markTaskSeen(db, me.id, task);
    await db.execute(sql`delete from tasks where id = ${task}`);
    const rows = [...(await db.execute(sql`select 1 from task_seen where task_id = ${task}`))];
    expect(rows).toHaveLength(0);
  });
});

describe('unseen changes of a ticket', () => {
  it('every ticket kind and a ticket chat mention count, until opened', async () => {
    const { me } = await setup();
    for (const kind of [
      'ticket.created',
      'ticket.unassigned',
      'ticket.message',
      'ticket.status',
      'ticket.updated',
      'ticket.tasks',
      'ticket.assigned',
      'ticket.time_missing',
      'chat.mention',
    ] as const) {
      const ticket = await newTicket(null);
      await ticketEvent(kind, me.id, null, ticket);
      expect({ kind, unseen: await ticketUnseen(me.id, ticket) }).toEqual({ kind, unseen: true });
      await markTicketSeen(db, me.id, ticket);
      expect({ kind, unseen: await ticketUnseen(me.id, ticket) }).toEqual({ kind, unseen: false });
    }
  });

  it('a message or a mention in its chat marks it with a ring, other changes a dot', async () => {
    const { me } = await setup();
    const ticket = await newTicket(null);
    await ticketEvent('ticket.status', me.id, null, ticket);
    expect(await ticketMark(me.id, ticket)).toBe('change');
    for (const kind of ['ticket.message', 'chat.mention'] as const) {
      await ticketEvent(kind, me.id, null, ticket);
      expect({ kind, mark: await ticketMark(me.id, ticket) }).toEqual({ kind, mark: 'message' });
      await markTicketSeen(db, me.id, ticket);
      await ticketEvent('ticket.updated', me.id, null, ticket);
      expect(await ticketMark(me.id, ticket)).toBe('change');
    }
  });

  it('passes every mode; only a tickets channel of None hides it', async () => {
    const { group, me } = await setup();
    const ticket = await newTicket(group.id);
    await ticketEvent('ticket.status', me.id, group.id, ticket);
    await setGroupMode(db, me.id, group.id, 'off');
    expect(await ticketUnseen(me.id, ticket)).toBe(true);
    await setNotificationChannel(db, me.id, 'tickets', 'none');
    expect(await ticketUnseen(me.id, ticket)).toBe(false);
  });

  it('clearTicketUnseenForAdmins sees it for every active admin, later events count again', async () => {
    const a = await newAdmin(db, 'Ada');
    const b = await newAdmin(db, 'Bob');
    const ticket = await newTicket(null);
    await ticketEvent('ticket.unassigned', a.id, null, ticket);
    await ticketEvent('ticket.unassigned', b.id, null, ticket);
    await clearTicketUnseenForAdmins(db, ticket);
    expect(await ticketUnseen(a.id, ticket)).toBe(false);
    expect(await ticketUnseen(b.id, ticket)).toBe(false);
    await ticketEvent('ticket.assigned', b.id, null, ticket);
    expect(await ticketUnseen(b.id, ticket)).toBe(true);
    expect(await ticketUnseen(a.id, ticket)).toBe(false);
  });
});

describe('unseen summaries (2026-10-18)', () => {
  it("a task's: only my own unseen events, after my last open, newest first", async () => {
    const { group, me, task } = await setup();
    const other = await newAdmin(db, 'Bob');
    await setGroupMode(db, me.id, group.id, 'all');
    await taskEvent('task.moved', me.id, group.id, task, {
      fromBucket: { kind: 'todo', name: null },
      toBucket: { kind: 'egrant_review', name: null },
    });
    await markTaskSeen(db, me.id, task);
    await taskEvent('task.assigned', me.id, group.id, task, { actorName: 'Bob' });
    await taskEvent('chat.message', me.id, group.id, task, { authorName: 'Jana' });
    // Bob's own event and another task's never show.
    await taskEvent('chat.message', other.id, group.id, task, { authorName: 'Eva' });
    const second = await newTask(db, { groupId: group.id, createdBy: me.id });
    await taskEvent('task.deadline', me.id, group.id, second, { daysLeft: 1 });
    expect(await taskUnseenSummary(db, me.id, task)).toEqual({
      lines: [{ kind: 'messages', count: 1, authors: ['Jana'] }, { kind: 'assigned' }],
      more: 0,
    });
    await markTaskSeen(db, me.id, task);
    expect(await taskUnseenSummary(db, me.id, task)).toEqual({ lines: [], more: 0 });
  });

  it("a task's follows the mode and the channel like the mark", async () => {
    const { group, me, task } = await setup();
    await setGroupMode(db, me.id, group.id, 'mentions');
    await taskEvent('chat.message', me.id, group.id, task, { authorName: 'Jana' });
    await taskEvent('task.urgent', me.id, group.id, task);
    expect(await taskUnseenSummary(db, me.id, task)).toEqual({ lines: [], more: 0 });
    await taskEvent('task.moved', me.id, group.id, task);
    expect((await taskUnseenSummary(db, me.id, task)).lines).toEqual([
      { kind: 'moved', from: null, to: null },
    ]);
    await setNotificationChannel(db, me.id, 'tasks', 'none');
    expect(await taskUnseenSummary(db, me.id, task)).toEqual({ lines: [], more: 0 });
  });

  it("a ticket's: every ticket kind it heard about", async () => {
    const { me } = await setup();
    const ticket = await newTicket(null);
    await ticketEvent('ticket.unassigned', me.id, null, ticket);
    await ticketEvent('ticket.status', me.id, null, ticket, { status: 'resolved' });
    await ticketEvent('chat.mention', me.id, null, ticket, { authorName: 'Peter' });
    expect(await ticketUnseenSummary(db, me.id, ticket)).toEqual({
      lines: [
        { kind: 'mentions', count: 1, authors: ['Peter'] },
        { kind: 'status', status: 'resolved' },
        { kind: 'created' },
      ],
      more: 0,
    });
    await markTicketSeen(db, me.id, ticket);
    expect(await ticketUnseenSummary(db, me.id, ticket)).toEqual({ lines: [], more: 0 });
  });
});
