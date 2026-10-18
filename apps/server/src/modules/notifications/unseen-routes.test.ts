import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AssignedTasksSchema,
  BoardUnseenSchema,
  GlobalBoardSchema,
  NavCountsSchema,
  SeenEvents,
  SidebarSchema,
  TicketListResponseSchema,
  UnseenSummarySchema,
} from '@spolu/shared';
import { eq, sql } from 'drizzle-orm';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { userRoom } from '../../infra/realtime/rooms.js';
import { newAdmin, newClient, newGroup } from '../home/test-fixtures.js';
import { tickets } from '../tickets/schema.js';
import { setGroupMode } from './modes.js';
import { recordNotifications } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** 2026-10-17: unseen changes through the API (marks, counts, the seen routes and their event). */
describe('unseen changes API', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(() => test.close());

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url: `/api${url}`, headers: { cookie }, payload });

  /** The events emitted to the user's own room while `run` runs. */
  const userRoomEvents = async (userId: string, run: () => Promise<unknown>) => {
    const events: unknown[] = [];
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
      return events;
    } finally {
      to.mockRestore();
    }
  };

  it('a task assigned to me is marked everywhere until I open it', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Unseen route');
    const nina = await newAdmin(db, 'Nina', [group.id]);
    const bob = await newAdmin(db, 'Bob');
    const ninaCookie = await loginAs(test.app, nina.email);
    const bobCookie = await loginAs(test.app, bob.email);
    const created = await call('POST', `/groups/${group.id}/tasks`, bobCookie, {
      title: 'Look at me',
      assigneeIds: [nina.id],
    });
    expect(created.statusCode).toBe(201);
    const taskId = created.json<{ id: string }>().id;

    const marks = async () => {
      const counts = NavCountsSchema.parse(
        (await call('GET', '/me/home/counts', ninaCookie)).json(),
      );
      const row = SidebarSchema.parse(
        (await call('GET', '/me/home/sidebar', ninaCookie)).json(),
      ).find((r) => r.groupId === group.id)!;
      const card = AssignedTasksSchema.parse(
        (await call('GET', '/me/home/tasks', ninaCookie)).json(),
      ).items.find((t) => t.id === taskId)!;
      const global = GlobalBoardSchema.parse(
        (await call('GET', `/tasks/global?clients=${group.id}`, ninaCookie)).json(),
      )
        .columns.flatMap((c) => c.items)
        .find((t) => t.id === taskId)!;
      const board = BoardUnseenSchema.parse(
        (await call('GET', `/groups/${group.id}/board/unseen`, ninaCookie)).json(),
      );
      return {
        header: counts.tasks,
        sidebar: row.unseenTasks,
        card: card.unseen,
        global: global.unseen,
        board: board.taskIds,
      };
    };
    expect(await marks()).toEqual({
      header: 1,
      sidebar: 1,
      card: 'change',
      global: 'change',
      board: [taskId],
    });
    // The actor heard nothing about their own change.
    expect(
      NavCountsSchema.parse((await call('GET', '/me/home/counts', bobCookie)).json()).tasks,
    ).toBe(0);

    let seen: Awaited<ReturnType<typeof call>> | undefined;
    const events = await userRoomEvents(nina.id, async () => {
      seen = await call('POST', `/tasks/${taskId}/seen`, ninaCookie);
    });
    expect(seen!.statusCode).toBe(204);
    expect(events).toEqual([[SeenEvents.changed, { kind: 'task', id: taskId, groupId: group.id }]]);
    expect(await marks()).toEqual({ header: 0, sidebar: 0, card: null, global: null, board: [] });
  });

  it('only who reads the task or ticket marks it seen (404 otherwise)', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Unseen 404');
    const other = await newGroup(db, 'Unseen other');
    const admin = await newAdmin(db, 'Ada');
    const outsider = await newClient(db, other.id, 'Olga');
    const adminCookie = await loginAs(test.app, admin.email);
    const outsiderCookie = await loginAs(test.app, outsider.email);
    const task = await call('POST', `/groups/${group.id}/tasks`, adminCookie, { title: 'Private' });
    const taskId = task.json<{ id: string }>().id;
    expect((await call('POST', `/tasks/${taskId}/seen`, outsiderCookie)).statusCode).toBe(404);
    expect((await call('POST', `/tasks/nope/seen`, adminCookie)).statusCode).toBe(404);
    expect((await call('GET', `/groups/${group.id}/board/unseen`, outsiderCookie)).statusCode).toBe(
      404,
    );
    const ticketId = randomUUID();
    const now = new Date();
    await db.insert(tickets).values({
      id: ticketId,
      groupId: group.id,
      status: 'new',
      source: 'manual',
      subject: 'Private',
      createdAt: now,
      updatedAt: now,
    });
    expect((await call('POST', `/tickets/${ticketId}/seen`, outsiderCookie)).statusCode).toBe(404);
    expect((await call('POST', `/tickets/${ticketId}/seen`, adminCookie)).statusCode).toBe(204);
  });

  it('a ticket without a client counts for every admin until opened or its first riešiteľ', async () => {
    const db = test.deps.db;
    const nina = await newAdmin(db, 'Nina');
    const bob = await newAdmin(db, 'Bob');
    const ada = await newAdmin(db, 'Ada');
    const cookies = {
      nina: await loginAs(test.app, nina.email),
      bob: await loginAs(test.app, bob.email),
      ada: await loginAs(test.app, ada.email),
    };
    const ticketId = randomUUID();
    const now = new Date();
    await db.insert(tickets).values({
      id: ticketId,
      groupId: null,
      status: 'new',
      source: 'api',
      subject: 'Nobody',
      createdAt: now,
      updatedAt: now,
    });
    await recordNotifications(db, {
      kind: 'ticket.unassigned',
      groupId: null,
      recipients: [nina.id, bob.id, ada.id],
      payload: { ticketId, groupId: null },
    });
    const unseen = async (cookie: string) => {
      const list = TicketListResponseSchema.parse(
        (await call('GET', '/tickets/global?scope=none', cookie)).json(),
      );
      return list.items.find((t) => t.id === ticketId)?.unseen;
    };
    const count = async (cookie: string) =>
      NavCountsSchema.parse((await call('GET', '/me/home/counts', cookie)).json()).tickets;

    expect(await unseen(cookies.nina)).toBe('change');
    const before = await count(cookies.ada);
    expect((await call('POST', `/tickets/${ticketId}/seen`, cookies.ada)).statusCode).toBe(204);
    expect(await unseen(cookies.ada)).toBe(null);
    expect(await count(cookies.ada)).toBe(before - 1);

    // Bob makes Nina its riešiteľ: nobody else needs to look; Nina has her ticket.assigned.
    const assigned = await call('PUT', `/tickets/${ticketId}/assignees/${nina.id}`, cookies.bob);
    expect(assigned.statusCode).toBe(200);
    expect(await unseen(cookies.bob)).toBe(null);
    expect(await unseen(cookies.ada)).toBe(null);
    expect(await unseen(cookies.nina)).toBe('change');
  });

  it('assigned, then a chat message: a ring and what changed, from my own events', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Unseen summary');
    const nina = await newAdmin(db, 'Nina', [group.id]);
    const bob = await newAdmin(db, 'Bob', [group.id]);
    const ninaCookie = await loginAs(test.app, nina.email);
    const bobCookie = await loginAs(test.app, bob.email);
    await setGroupMode(db, nina.id, group.id, 'all');
    const created = await call('POST', `/groups/${group.id}/tasks`, bobCookie, {
      title: 'Ring me',
      assigneeIds: [nina.id, bob.id],
    });
    const taskId = created.json<{ id: string }>().id;
    const channelId = (await call('GET', `/tasks/${taskId}/chat`, bobCookie)).json<{ id: string }>()
      .id;
    const sent = await call('POST', `/channels/${channelId}/messages`, bobCookie, {
      body: 'Hi',
      fileIds: [],
      clientId: randomUUID(),
    });
    expect(sent.statusCode).toBe(201);

    const card = async () =>
      AssignedTasksSchema.parse(
        (await call('GET', '/me/home/tasks', ninaCookie)).json(),
      ).items.find((t) => t.id === taskId)?.unseen;
    const board = async () =>
      BoardUnseenSchema.parse(
        (await call('GET', `/groups/${group.id}/board/unseen`, ninaCookie)).json(),
      );
    expect(await card()).toBe('message');
    expect(await board()).toEqual({ taskIds: [taskId], messageTaskIds: [taskId] });
    const summary = await call('GET', `/tasks/${taskId}/unseen-summary`, ninaCookie);
    expect(summary.statusCode).toBe(200);
    expect(UnseenSummarySchema.parse(summary.json())).toEqual({
      lines: [{ kind: 'messages', count: 1, authors: ['Bob'] }, { kind: 'assigned' }],
      more: 0,
    });
    // Bob wrote the message and assigned the task: he heard of nothing.
    expect(
      UnseenSummarySchema.parse(
        (await call('GET', `/tasks/${taskId}/unseen-summary`, bobCookie)).json(),
      ),
    ).toEqual({ lines: [], more: 0 });

    await call('POST', `/tasks/${taskId}/seen`, ninaCookie);
    expect(await card()).toBe(null);
    expect(await board()).toEqual({ taskIds: [], messageTaskIds: [] });
  });

  it('a ticket whose status changed: a dot and its status', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Unseen ticket summary');
    const nina = await newAdmin(db, 'Nina', [group.id]);
    const bob = await newAdmin(db, 'Bob');
    const ninaCookie = await loginAs(test.app, nina.email);
    const bobCookie = await loginAs(test.app, bob.email);
    const ticketId = randomUUID();
    const now = new Date();
    await db.insert(tickets).values({
      id: ticketId,
      groupId: group.id,
      status: 'new',
      source: 'manual',
      subject: 'Status',
      createdAt: now,
      updatedAt: now,
    });
    await call('POST', `/tickets/${ticketId}/seen`, ninaCookie);
    const patched = await call('PATCH', `/tickets/${ticketId}`, bobCookie, { status: 'resolved' });
    expect(patched.statusCode).toBe(200);
    const row = TicketListResponseSchema.parse(
      (await call('GET', `/tickets/global?scope=all&status=all`, ninaCookie)).json(),
    ).items.find((t) => t.id === ticketId);
    expect(row?.unseen).toBe('change');
    const summary = await call('GET', `/tickets/${ticketId}/unseen-summary`, ninaCookie);
    expect(summary.statusCode).toBe(200);
    expect(UnseenSummarySchema.parse(summary.json()).lines).toEqual([
      { kind: 'status', status: 'resolved' },
    ]);
  });

  it('the summaries: 404 for whoever cannot read the item now', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Summary 404');
    const other = await newGroup(db, 'Summary other');
    const admin = await newAdmin(db, 'Ada');
    const client = await newClient(db, group.id, 'Cyril');
    const foreign = await newClient(db, other.id, 'Olga');
    const ziadatel = await newClient(db, other.id, 'Zora');
    await db.execute(
      sql`insert into group_members (user_id, group_id, role) values (${ziadatel.id}, ${group.id}, 'ziadatel')`,
    );
    const cookies = {
      admin: await loginAs(test.app, admin.email),
      client: await loginAs(test.app, client.email),
      foreign: await loginAs(test.app, foreign.email),
      ziadatel: await loginAs(test.app, ziadatel.email),
    };
    const task = await call('POST', `/groups/${group.id}/tasks`, cookies.admin, { title: 'T' });
    const taskId = task.json<{ id: string }>().id;
    const ticketId = randomUUID();
    const ownId = randomUUID();
    const now = new Date();
    for (const [id, requesterUserId] of [
      [ticketId, null],
      [ownId, ziadatel.id],
    ] as const) {
      await db.insert(tickets).values({
        id,
        groupId: group.id,
        status: 'new',
        source: 'manual',
        subject: 'S',
        requesterUserId,
        createdAt: now,
        updatedAt: now,
      });
    }
    const status = async (url: string, cookie: string) =>
      (await call('GET', url, cookie)).statusCode;
    const taskUrl = `/tasks/${taskId}/unseen-summary`;
    const ticketUrl = `/tickets/${ticketId}/unseen-summary`;
    expect(await status(taskUrl, cookies.admin)).toBe(200);
    expect(await status(taskUrl, cookies.client)).toBe(200);
    expect(await status(taskUrl, cookies.foreign)).toBe(404);
    expect(await status(taskUrl, cookies.ziadatel)).toBe(404);
    expect(await status('/tasks/nope/unseen-summary', cookies.admin)).toBe(404);
    expect(await status(ticketUrl, cookies.admin)).toBe(200);
    expect(await status(ticketUrl, cookies.client)).toBe(200);
    expect(await status(ticketUrl, cookies.foreign)).toBe(404);
    expect(await status(ticketUrl, cookies.ziadatel)).toBe(404);
    expect(await status(`/tickets/${ownId}/unseen-summary`, cookies.ziadatel)).toBe(200);
    expect(await status(`/tickets/${randomUUID()}/unseen-summary`, cookies.admin)).toBe(404);

    // The ticket moves to another client: its old client loses it, and its summary with it.
    await db.update(tickets).set({ groupId: other.id }).where(eq(tickets.id, ticketId));
    expect(await status(ticketUrl, cookies.client)).toBe(404);
    expect(await status(ticketUrl, cookies.foreign)).toBe(200);
  });
});
