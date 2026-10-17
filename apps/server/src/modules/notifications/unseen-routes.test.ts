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
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { userRoom } from '../../infra/realtime/rooms.js';
import { newAdmin, newClient, newGroup } from '../home/test-fixtures.js';
import { tickets } from '../tickets/schema.js';
import { recordNotifications } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** 2026-10-17: unseen changes through the API (marks, counts, the seen routes and their event). */
describe('unseen changes API', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(() => test.close());

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url: `/api${url}`, headers: { cookie }, payload });

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
      card: true,
      global: true,
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
    expect(events).toEqual([[SeenEvents.changed, { kind: 'task', id: taskId }]]);
    expect(await marks()).toEqual({ header: 0, sidebar: 0, card: false, global: false, board: [] });
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

    expect(await unseen(cookies.nina)).toBe(true);
    const before = await count(cookies.ada);
    expect((await call('POST', `/tickets/${ticketId}/seen`, cookies.ada)).statusCode).toBe(204);
    expect(await unseen(cookies.ada)).toBe(false);
    expect(await count(cookies.ada)).toBe(before - 1);

    // Bob makes Nina its riešiteľ: nobody else needs to look; Nina has her ticket.assigned.
    const assigned = await call('PUT', `/tickets/${ticketId}/assignees/${nina.id}`, cookies.bob);
    expect(assigned.statusCode).toBe(200);
    expect(await unseen(cookies.bob)).toBe(false);
    expect(await unseen(cookies.ada)).toBe(false);
    expect(await unseen(cookies.nina)).toBe(true);
  });
});
