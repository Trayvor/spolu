import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import {
  BoardUnseenSchema,
  GlobalBoardSchema,
  NotificationEvents,
  TicketListResponseSchema,
  type NotificationCentreState,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { userRoom } from '../../infra/realtime/rooms.js';
import { newAdmin, newClient, newGroup, newTask } from '../home/test-fixtures.js';
import { tickets } from '../tickets/schema.js';
import { parseSubjectKey } from './subject-read.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/**
 * Read on open (2026-10-19, ADR 0060): opening a task, a ticket, a group chat, a project, a
 * knowledge item or a project event by any route reads the person's own centre items about it,
 * and the lists mark what still has unread items.
 */
describe('read on open', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(() => test.close());

  const call = (method: 'GET' | 'POST', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url: `/api${url}`, headers: { cookie }, payload });

  /** The events emitted to the user's own room while `run` runs. */
  const userRoomEvents = async (userId: string, run: () => Promise<unknown>) => {
    const events: [string, unknown][] = [];
    const to = vi.spyOn(test.app.io, 'to').mockImplementation((room) => {
      const target = room === userRoom(userId);
      return {
        emit: (event: string, payload: unknown) => {
          if (target) events.push([event, payload]);
          return true;
        },
      } as unknown as ReturnType<typeof test.app.io.to>;
    });
    try {
      await run();
      return events.filter(([name]) => name === NotificationEvents.read);
    } finally {
      to.mockRestore();
    }
  };

  /** A delivered centre item, written directly (delivery itself is tested elsewhere). */
  async function item(
    userId: string,
    groupId: string | null,
    kind: string,
    payload: Record<string, unknown>,
  ) {
    const id = randomUUID();
    await test.deps.db.execute(sql`
      insert into notification_events (id, user_id, group_id, kind, payload, in_centre, delivered_at)
      values (${id}, ${userId}, ${groupId}, ${kind}, ${JSON.stringify(payload)}::jsonb, true, now())
    `);
    return id;
  }

  async function unreadIds(userId: string): Promise<string[]> {
    const rows = await test.deps.db.execute<{ id: string }>(sql`
      select id from notification_events
      where user_id = ${userId} and in_centre and read_at is null order by id
    `);
    return [...rows].map((r) => r.id).sort();
  }

  const bell = async (cookie: string) =>
    (await call('GET', '/me/notifications/state', cookie)).json<NotificationCentreState>().unread;

  it('names the subject the way the push tag does', () => {
    expect(parseSubjectKey('task:abc')).toEqual({ kind: 'task', id: 'abc' });
    expect(parseSubjectKey('chat:a:b')).toEqual({ kind: 'chat', id: 'a:b' });
    expect(parseSubjectKey('nope:abc')).toBeNull();
    expect(parseSubjectKey('task:')).toBeNull();
    expect(parseSubjectKey(null)).toBeNull();
  });

  it("opening a task reads only my items about it; the board's mark goes with them", async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Read task');
    const nina = await newAdmin(db, 'Nina', [group.id]);
    const bob = await newAdmin(db, 'Bob', [group.id]);
    const ninaCookie = await loginAs(test.app, nina.email);
    const taskId = await newTask(db, { groupId: group.id, createdBy: bob.id, title: 'Open me' });
    const otherTask = await newTask(db, { groupId: group.id, createdBy: bob.id, title: 'Other' });
    const p = { groupId: group.id, taskId };
    const mine = [
      await item(nina.id, group.id, 'task.assigned', p),
      // Not an unseen change, still a centre item about the task.
      await item(nina.id, group.id, 'task.urgent', p),
      await item(nina.id, group.id, 'chat.message', { ...p, channelId: randomUUID() }),
      await item(nina.id, group.id, 'description.mention', {
        ...p,
        subjectKind: 'task',
        subjectId: taskId,
      }),
    ];
    const other = await item(nina.id, group.id, 'task.moved', {
      groupId: group.id,
      taskId: otherTask,
    });
    const bobs = await item(bob.id, group.id, 'task.assigned', p);
    expect(await bell(ninaCookie)).toBe(5);

    // The board marks both tasks, the global board the opened one.
    const board = async () =>
      BoardUnseenSchema.parse(
        (await call('GET', `/groups/${group.id}/board/unseen`, ninaCookie)).json(),
      ).taskIds.sort();
    const global = async () =>
      GlobalBoardSchema.parse(
        (await call('GET', `/tasks/global?clients=${group.id}`, ninaCookie)).json(),
      )
        .columns.flatMap((c) => c.items)
        .find((t) => t.id === taskId)?.unseen;
    expect(await board()).toEqual([taskId, otherTask].sort());
    expect(await global()).not.toBeNull();

    const events = await userRoomEvents(nina.id, async () => {
      expect((await call('POST', `/tasks/${taskId}/seen`, ninaCookie)).statusCode).toBe(204);
    });
    expect(events).toEqual([
      [NotificationEvents.read, { id: null, subject: { kind: 'task', id: taskId } }],
    ]);
    expect(await unreadIds(nina.id)).toEqual([other]);
    expect(await unreadIds(bob.id)).toEqual([bobs]);
    expect(await bell(ninaCookie)).toBe(1);
    expect(await board()).toEqual([otherTask]);
    expect(await global()).toBeNull();
    expect(mine).toHaveLength(4);

    // Opening it again reads nothing and tells nobody.
    const again = await userRoomEvents(nina.id, () =>
      call('POST', `/tasks/${taskId}/seen`, ninaCookie),
    );
    expect(again).toEqual([]);
  });

  it('a task I cannot read is not opened: 404, and my item about it stays unread', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Read hidden');
    const elsewhere = await newGroup(db, 'Read elsewhere');
    const admin = await newAdmin(db, 'Ada');
    const outsider = await newClient(db, elsewhere.id, 'Olga');
    const cookie = await loginAs(test.app, outsider.email);
    const taskId = await newTask(db, { groupId: group.id, createdBy: admin.id });
    const stale = await item(outsider.id, group.id, 'task.moved', { groupId: group.id, taskId });
    expect((await call('POST', `/tasks/${taskId}/seen`, cookie)).statusCode).toBe(404);
    expect(await unreadIds(outsider.id)).toEqual([stale]);
  });

  it('opening a ticket reads my items about it, its chat mentions too; the list marks it until then', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Read ticket');
    const nina = await newAdmin(db, 'Nina', [group.id]);
    const cookie = await loginAs(test.app, nina.email);
    const ticketId = randomUUID();
    const now = new Date();
    await db.insert(tickets).values({
      id: ticketId,
      groupId: group.id,
      status: 'new',
      source: 'manual',
      subject: 'Read me',
      createdAt: now,
      updatedAt: now,
    });
    // Seen first: the list's mark then comes from the unread items alone.
    await call('POST', `/tickets/${ticketId}/seen`, cookie);
    const p = { groupId: group.id, ticketId };
    await item(nina.id, group.id, 'ticket.rated', p);
    const mark = async () =>
      TicketListResponseSchema.parse(
        (await call('GET', '/tickets/global?scope=all&status=all', cookie)).json(),
      ).items.find((t) => t.id === ticketId)?.unseen;
    expect(await mark()).toBe('change');
    // A mention in its chat is an unseen change as well (a ring).
    await item(nina.id, group.id, 'chat.mention', { ...p, channelId: randomUUID(), taskId: null });
    expect(await mark()).toBe('message');
    expect(await bell(cookie)).toBe(2);

    const events = await userRoomEvents(nina.id, async () => {
      expect((await call('POST', `/tickets/${ticketId}/seen`, cookie)).statusCode).toBe(204);
    });
    expect(events).toEqual([
      [NotificationEvents.read, { id: null, subject: { kind: 'ticket', id: ticketId } }],
    ]);
    expect(await bell(cookie)).toBe(0);
    expect(await mark()).toBeNull();
  });

  it('"Mark all as read" also clears the marks that came from unread items', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Read all');
    const nina = await newAdmin(db, 'Nina', [group.id]);
    const cookie = await loginAs(test.app, nina.email);
    const taskId = await newTask(db, { groupId: group.id, createdBy: nina.id });
    await item(nina.id, group.id, 'task.urgent', { groupId: group.id, taskId });
    const board = async () =>
      BoardUnseenSchema.parse(
        (await call('GET', `/groups/${group.id}/board/unseen`, cookie)).json(),
      ).taskIds;
    expect(await board()).toEqual([taskId]);
    expect((await call('POST', '/me/notifications/read', cookie)).statusCode).toBe(204);
    expect(await board()).toEqual([]);
  });

  it('reading the group chat reads its messages and thread replies, not a task chat', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Read chat');
    const admin = await newAdmin(db, 'Ada');
    const client = await newClient(db, group.id, 'Cyril');
    const cookie = await loginAs(test.app, client.email);
    const taskId = await newTask(db, { groupId: group.id, createdBy: admin.id });
    const c = { groupId: group.id, channelId: group.channelId, messageId: randomUUID() };
    await item(client.id, group.id, 'chat.message', { ...c, taskId: null });
    await item(client.id, group.id, 'chat.thread_reply', { ...c, taskId: null });
    const inTask = await item(client.id, group.id, 'chat.message', {
      ...c,
      channelId: randomUUID(),
      taskId,
    });
    const events = await userRoomEvents(client.id, async () => {
      const read = await call('POST', `/channels/${group.channelId}/read`, cookie, {
        at: new Date().toISOString(),
      });
      expect(read.statusCode).toBe(204);
    });
    expect(events).toEqual([
      [NotificationEvents.read, { id: null, subject: { kind: 'chat', id: group.channelId } }],
    ]);
    expect(await unreadIds(client.id)).toEqual([inTask]);
  });

  it('opening a project, a knowledge item or a project event reads my items about it', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Read others');
    const nina = await newAdmin(db, 'Nina', [group.id]);
    const cookie = await loginAs(test.app, nina.email);
    const project = await call('POST', `/groups/${group.id}/projects`, cookie, { name: 'Kultúra' });
    expect(project.statusCode).toBe(201);
    const projectId = project.json<{ id: string }>().id;
    const event = await call('POST', `/projects/${projectId}/events`, cookie, {
      name: 'Kickoff',
      occursOn: '2026-11-04',
    });
    expect(event.statusCode).toBe(201);
    const eventId = event.json<{ id: string }>().id;
    const note = await call('POST', `/groups/${group.id}/knowledge`, cookie, {
      type: 'note',
      title: 'Poznámka',
    });
    expect(note.statusCode).toBe(201);
    const itemId = note.json<{ id: string }>().id;
    const g = { groupId: group.id };
    await item(nina.id, group.id, 'description.mention', {
      ...g,
      subjectKind: 'project',
      subjectId: projectId,
    });
    await item(nina.id, group.id, 'reminder.due', {
      ...g,
      subjectKind: 'event',
      subjectId: eventId,
    });
    await item(nina.id, group.id, 'reminder.due', {
      ...g,
      subjectKind: 'knowledge',
      subjectId: itemId,
    });
    await item(nina.id, group.id, 'meeting.summary_ready', { ...g, itemId });
    expect(await bell(cookie)).toBe(4);

    for (const [url, after] of [
      [`/projects/${projectId}/seen`, 3],
      [`/project-events/${eventId}/seen`, 2],
      [`/knowledge/${itemId}/seen`, 0],
    ] as const) {
      expect((await call('POST', url, cookie)).statusCode).toBe(204);
      expect({ url, unread: await bell(cookie) }).toEqual({ url, unread: after });
    }
    // An event nobody may read answers 404.
    expect((await call('POST', `/project-events/${randomUUID()}/seen`, cookie)).statusCode).toBe(
      404,
    );
  });
});
