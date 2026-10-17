import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { AssignedTasks, BoardDto, TaskTimeDto, TicketDto, TicketTimeDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { tasks } from '../tasks/schema.js';
import { ticketAssignees, tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { financeTimeEntries } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('time on done: routes and task/ticket hooks', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const call = (method: string, url: string, cookie: string, payload?: unknown) =>
    test.app.inject({
      method: method as 'GET',
      url,
      headers: { cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function adminSession(name: string, finance = false) {
    const email = newEmail();
    const row = await addAdmin(test.deps.db, { email, name });
    if (finance) {
      await test.deps.db
        .update(user)
        .set({ financeAccessAt: new Date() })
        .where(eq(user.id, row.id));
    }
    return { id: row.id, cookie: await loginAs(test.app, email) };
  }
  async function clientIn(groupId: string) {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Client', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  async function setup() {
    const group = await createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });
    const a = await adminSession('Eva');
    const b = await adminSession('Ján');
    const c = await clientIn(group.id);
    // Admins are pickable assignees of the clients they manage.
    await addManager(test.deps.db, group.id, a.id);
    await addManager(test.deps.db, group.id, b.id);
    const board = (await call('GET', `/api/groups/${group.id}/board`, a.cookie)).json<BoardDto>();
    const bucket = (kind: string) => board.buckets.find((x) => x.kind === kind)!.id;
    const created = await call('POST', `/api/groups/${group.id}/tasks`, a.cookie, {
      title: 'Budget',
      description: '',
      assigneeIds: [a.id, b.id, c.id],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ askTime: false });
    return { groupId: group.id, a, b, c, taskId: created.json<{ id: string }>().id, bucket };
  }

  const move = (s: Awaited<ReturnType<typeof setup>>, cookie: string, kind: string) =>
    call('POST', `/api/tasks/${s.taskId}/move`, cookie, {
      bucketId: s.bucket(kind),
      afterTaskId: null,
    });
  const home = async (cookie: string) =>
    (await call('GET', '/api/me/home/tasks', cookie)).json<AssignedTasks>();

  it('completing asks the acting admin assignee; the other admin gets a dashboard row', async () => {
    const s = await setup();
    const res = await move(s, s.a.cookie, 'done');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: s.taskId, askTime: true });
    const forB = await home(s.b.cookie);
    expect(forB.timeRequestCount).toBe(1);
    expect(forB.timeRequests).toMatchObject([
      { kind: 'task', taskId: s.taskId, title: 'Budget', groupName: 'Firma' },
    ]);
    // B fills 0: the row goes.
    const put = await call('PUT', `/api/tasks/${s.taskId}/time/me`, s.b.cookie, { minutes: 0 });
    expect(put.statusCode).toBe(200);
    expect(put.json<TaskTimeDto>()).toEqual({ mine: { minutes: 0, requested: false } });
    expect((await home(s.b.cookie)).timeRequestCount).toBe(0);
    // Moving inside Completed is no new completion.
    expect((await move(s, s.a.cookie, 'done')).json()).toMatchObject({ askTime: false });
  });

  it('a client completing gets no askTime; every admin assignee is asked', async () => {
    const s = await setup();
    expect((await move(s, s.c.cookie, 'done')).json()).toMatchObject({ askTime: false });
    expect((await home(s.a.cookie)).timeRequestCount).toBe(1);
    expect((await home(s.b.cookie)).timeRequestCount).toBe(1);
  });

  it('reopen drops the requests; completing again asks again', async () => {
    const s = await setup();
    await move(s, s.a.cookie, 'done');
    await move(s, s.a.cookie, 'todo');
    expect((await home(s.b.cookie)).timeRequestCount).toBe(0);
    expect((await move(s, s.b.cookie, 'done')).json()).toMatchObject({ askTime: true });
    expect((await home(s.a.cookie)).timeRequestCount).toBe(1);
  });

  it('creating straight in Completed asks the creator when they are an admin assignee', async () => {
    const s = await setup();
    const res = await call('POST', `/api/groups/${s.groupId}/tasks`, s.a.cookie, {
      title: 'Done at once',
      description: '',
      assigneeIds: [s.a.id],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
      bucketId: s.bucket('done'),
    });
    expect(res.json()).toMatchObject({ askTime: true });
  });

  it('removing an assignee and deleting the task drop their requests', async () => {
    const s = await setup();
    await move(s, s.a.cookie, 'done');
    const task = (await call('GET', `/api/tasks/${s.taskId}`, s.a.cookie)).json<{
      updatedAt: string;
    }>();
    const patched = await call('PATCH', `/api/tasks/${s.taskId}`, s.a.cookie, {
      assigneeIds: [s.a.id, s.c.id],
      updatedAt: task.updatedAt,
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ askTime: false });
    expect((await home(s.b.cookie)).timeRequestCount).toBe(0);
    await call('PUT', `/api/tasks/${s.taskId}/time/me`, s.a.cookie, { minutes: 90 });
    expect((await call('DELETE', `/api/tasks/${s.taskId}`, s.a.cookie)).statusCode).toBe(204);
    const kept = await test.deps.db
      .select()
      .from(financeTimeEntries)
      .where(and(eq(financeTimeEntries.userId, s.a.id), eq(financeTimeEntries.groupId, s.groupId)));
    expect(kept).toMatchObject([{ minutes: 90, taskId: null, title: 'Budget' }]);
  });

  it('the time routes: only admin assignees write; only finance admins see others', async () => {
    const s = await setup();
    const url = `/api/tasks/${s.taskId}/time`;
    expect((await call('GET', url, s.c.cookie)).statusCode).toBe(403);
    expect((await call('PUT', `${url}/me`, s.c.cookie, { minutes: 5 })).statusCode).toBe(403);
    const other = await adminSession('Other');
    expect((await call('PUT', `${url}/me`, other.cookie, { minutes: 5 })).statusCode).toBe(403);
    expect((await call('GET', url, other.cookie)).statusCode).toBe(403);
    expect(
      (await call('PUT', `/api/tasks/${randomUUID()}/time/me`, s.a.cookie, { minutes: 5 }))
        .statusCode,
    ).toBe(404);
    expect((await call('PUT', `${url}/me`, s.a.cookie, { minutes: 6001 })).statusCode).toBe(400);
    // Filled before completion: no dialog later.
    expect((await call('PUT', `${url}/me`, s.a.cookie, { minutes: 30 })).statusCode).toBe(200);
    expect((await move(s, s.a.cookie, 'done')).json()).toMatchObject({ askTime: false });
    expect((await call('GET', url, s.a.cookie)).json<TaskTimeDto>()).toEqual({
      mine: { minutes: 30, requested: false },
    });
    const fin = await adminSession('Fin', true);
    const seen = (await call('GET', url, fin.cookie)).json<TaskTimeDto>();
    expect(seen.mine).toBeNull();
    expect(seen.assignees?.map((x) => [x.name, x.minutes, x.requested])).toEqual([
      ['Eva', 30, false],
      ['Ján', null, true],
    ]);
    // The task DTO carries no time.
    const dto = (await call('GET', `/api/tasks/${s.taskId}`, fin.cookie)).json<object>();
    expect(JSON.stringify(dto)).not.toMatch(/minutes|askTime/);
    void tasks;
  });

  describe('tickets', () => {
    async function ticketSetup(withClient = true) {
      const s = await setup();
      const id = randomUUID();
      const [row] = await test.deps.db
        .insert(tickets)
        .values({
          id,
          groupId: withClient ? s.groupId : null,
          source: 'manual',
          subject: 'Login fails',
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning({ number: tickets.number });
      await test.deps.db.insert(ticketAssignees).values([
        { ticketId: id, userId: s.a.id },
        { ticketId: id, userId: s.b.id },
      ]);
      return { ...s, ticketId: id, number: row!.number };
    }
    const status = (cookie: string, id: string, value: string) =>
      call('PATCH', `/api/tickets/${id}`, cookie, { status: value });

    it('resolving asks the acting admin riešiteľ; the other admin gets a row', async () => {
      const s = await ticketSetup();
      const res = await status(s.a.cookie, s.ticketId, 'resolved');
      expect(res.statusCode).toBe(200);
      expect(res.json<TicketDto & { askTime: boolean }>()).toMatchObject({
        status: 'resolved',
        askTime: true,
      });
      const forB = await home(s.b.cookie);
      expect(forB.timeRequests).toMatchObject([
        { kind: 'ticket', ticketId: s.ticketId, title: `#${s.number} Login fails` },
      ]);
      const put = await call('PUT', `/api/tickets/${s.ticketId}/time/me`, s.b.cookie, {
        coveredByTasks: true,
      });
      expect(put.statusCode).toBe(200);
      expect(put.json<TicketTimeDto>().mine).toEqual({
        minutes: 0,
        requested: false,
        coveredByTasks: true,
      });
      expect((await home(s.b.cookie)).timeRequestCount).toBe(0);
      // Reopen drops A's request.
      await status(s.a.cookie, s.ticketId, 'in_progress');
      expect((await home(s.a.cookie)).timeRequestCount).toBe(0);
    });

    it('removing a riešiteľ drops their request', async () => {
      const s = await ticketSetup();
      await status(s.a.cookie, s.ticketId, 'resolved');
      const del = await call(
        'DELETE',
        `/api/tickets/${s.ticketId}/assignees/${s.b.id}`,
        s.a.cookie,
      );
      expect(del.statusCode).toBe(200);
      expect((await home(s.b.cookie)).timeRequestCount).toBe(0);
    });

    it('a ticket without a client asks time too, recorded without a client (decision 24)', async () => {
      const s = await ticketSetup(false);
      expect((await status(s.a.cookie, s.ticketId, 'resolved')).json()).toMatchObject({
        askTime: true,
      });
      expect((await home(s.b.cookie)).timeRequests).toMatchObject([
        { kind: 'ticket', ticketId: s.ticketId, groupId: null, groupName: null },
      ]);
      const put = await call('PUT', `/api/tickets/${s.ticketId}/time/me`, s.a.cookie, {
        minutes: 30,
      });
      expect(put.statusCode).toBe(200);
      const [row] = await test.deps.db
        .select()
        .from(financeTimeEntries)
        .where(
          and(eq(financeTimeEntries.ticketId, s.ticketId), eq(financeTimeEntries.userId, s.a.id)),
        );
      expect(row).toMatchObject({ groupId: null, minutes: 30 });
      // Getting a client moves the entries there.
      const moved = await call('PUT', `/api/tickets/${s.ticketId}/group`, s.a.cookie, {
        groupId: s.groupId,
      });
      expect(moved.statusCode).toBe(200);
      const after = await test.deps.db
        .select({ groupId: financeTimeEntries.groupId })
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.ticketId, s.ticketId));
      expect(after.map((r) => r.groupId)).toEqual([s.groupId, s.groupId]);
    });

    it('the ticket time routes: 404 unknown, 403 client and non-riešiteľ, 400 bad body', async () => {
      const s = await ticketSetup();
      const url = `/api/tickets/${s.ticketId}/time`;
      expect((await call('GET', `/api/tickets/${randomUUID()}/time`, s.a.cookie)).statusCode).toBe(
        404,
      );
      expect((await call('GET', url, s.c.cookie)).statusCode).toBe(403);
      const other = await adminSession('Other');
      expect((await call('PUT', `${url}/me`, other.cookie, { minutes: 1 })).statusCode).toBe(403);
      expect(
        (await call('PUT', `${url}/me`, s.a.cookie, { coveredByTasks: false })).statusCode,
      ).toBe(400);
      const got = (await call('GET', url, s.a.cookie)).json<TicketTimeDto>();
      expect(got).toEqual({
        mine: { minutes: null, requested: false, coveredByTasks: false },
        linkedTasks: [],
        linkedTasksLogged: false,
      });
      const dto = (await call('GET', `/api/tickets/${s.ticketId}`, s.a.cookie)).json<object>();
      expect(JSON.stringify(dto)).not.toMatch(/minutes|askTime|coveredByTasks/);
    });
  });
});
