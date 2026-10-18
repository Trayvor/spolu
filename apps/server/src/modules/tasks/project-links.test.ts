import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type {
  BoardDonePage,
  BoardDto,
  GlobalBoard,
  ProjectDto,
  ProjectEventDto,
  TaskDetailDto,
  TasksFromMessageResult,
  TicketDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { insertTask } from '../../../test/tasks.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { reassignTaskProject } from './project-links.js';
import { tasks } from './schema.js';
import { getBoard } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://t${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

/** Phase 33 part P2: tasks on projects and events, and the board filters. */
describe('tasks on projects', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: Method, url: string, cookie?: string, payload?: object) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });
  const group = () => createGroup(db(), { name: `Firma ${randomUUID().slice(0, 6)}`, egrantUrl: newUrl() });
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel' = 'client') {
    const c = await createUnverifiedClient(db(), newEmail(), 'Klient');
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  async function project(groupId: string, cookie: string, name = `Kultúra ${randomUUID().slice(0, 6)}`) {
    const res = await call('POST', `/api/groups/${groupId}/projects`, cookie, { name });
    expect(res.statusCode).toBe(201);
    return res.json<ProjectDto>();
  }
  async function event(projectId: string, cookie: string, name = 'Kickoff') {
    const res = await call('POST', `/api/projects/${projectId}/events`, cookie, {
      name,
      occursOn: '2026-11-04',
    });
    expect(res.statusCode).toBe(201);
    return res.json<ProjectEventDto>();
  }
  /** A client group with a project of two events, and an admin and a client. */
  async function setup() {
    const g = await group();
    const a = await admin();
    const client = await member(g.id);
    const p = await project(g.id, a.cookie);
    const e1 = await event(p.id, a.cookie, 'Kickoff');
    const e2 = await event(p.id, a.cookie, 'Final report');
    return { g, a, client, p, e1, e2 };
  }
  const createTask = (groupId: string, cookie: string, body: object) =>
    call('POST', `/api/groups/${groupId}/tasks`, cookie, { title: 'Budget', ...body });

  describe('create and edit', () => {
    it('a client creates a task on an event; the DTOs carry the project and the event', async () => {
      const { g, client, p, e1 } = await setup();
      const res = await createTask(g.id, client.cookie, { projectId: p.id, eventId: e1.id });
      expect(res.statusCode).toBe(201);
      const task = res.json<TaskDetailDto>();
      expect(task.project).toEqual({ id: p.id, name: p.name, color: p.color });
      expect(task.event).toEqual({ id: e1.id, name: 'Kickoff', occursOn: '2026-11-04' });
      const read = await call('GET', `/api/tasks/${task.id}`, client.cookie);
      expect(read.json<TaskDetailDto>().event?.id).toBe(e1.id);
      const board = (await call('GET', `/api/groups/${g.id}/board`, client.cookie)).json<BoardDto>();
      expect(board.tasks.find((t) => t.id === task.id)?.project?.id).toBe(p.id);
    });

    it('a project alone, and none by default', async () => {
      const { g, a, p } = await setup();
      const onProject = (await createTask(g.id, a.cookie, { projectId: p.id })).json<TaskDetailDto>();
      expect(onProject.project?.id).toBe(p.id);
      expect(onProject.event).toBeNull();
      const plain = (await createTask(g.id, a.cookie, {})).json<TaskDetailDto>();
      expect(plain.project).toBeNull();
    });

    it('pairs that do not fit answer 400 invalid_project and write nothing', async () => {
      const { g, a, p, e1 } = await setup();
      const other = await group();
      const foreign = await project(other.id, a.cookie);
      const otherProject = await project(g.id, a.cookie);
      const bad = [
        { projectId: foreign.id },
        { projectId: otherProject.id, eventId: e1.id },
        { projectId: null, eventId: e1.id },
        { eventId: e1.id },
        { projectId: 'missing' },
      ];
      for (const body of bad) {
        const res = await createTask(g.id, a.cookie, { ...body, title: 'Bad pair' });
        expect({ body, status: res.statusCode, error: res.json().error }).toEqual({
          body,
          status: 400,
          error: 'invalid_project',
        });
      }
      const rows = await db().select().from(tasks).where(eq(tasks.groupId, g.id));
      expect(rows.filter((r) => r.title === 'Bad pair')).toHaveLength(0);
      expect(p.id).toBeTruthy();
    });

    it('PATCH sets, changes the event, keeps it when absent, and clears both', async () => {
      const { g, client, p, e1, e2 } = await setup();
      let task = (await createTask(g.id, client.cookie, {})).json<TaskDetailDto>();
      const patch = async (body: object) => {
        const res = await call('PATCH', `/api/tasks/${task.id}`, client.cookie, {
          ...body,
          updatedAt: task.updatedAt,
        });
        expect(res.statusCode).toBe(200);
        task = res.json<TaskDetailDto>();
        return task;
      };
      expect((await patch({ projectId: p.id, eventId: e1.id })).event?.id).toBe(e1.id);
      expect((await patch({ eventId: e2.id })).event?.id).toBe(e2.id);
      expect((await patch({ title: 'Renamed' })).event?.id).toBe(e2.id);
      expect((await patch({ eventId: null })).project?.id).toBe(p.id);
      expect(task.event).toBeNull();
      await patch({ eventId: e1.id });
      const cleared = await patch({ projectId: null });
      expect([cleared.project, cleared.event]).toEqual([null, null]);
    });

    it('changing the project without an event clears the old event', async () => {
      const { g, a, p, e1 } = await setup();
      const other = await project(g.id, a.cookie);
      const task = (
        await createTask(g.id, a.cookie, { projectId: p.id, eventId: e1.id })
      ).json<TaskDetailDto>();
      const res = await call('PATCH', `/api/tasks/${task.id}`, a.cookie, {
        projectId: other.id,
        updatedAt: task.updatedAt,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<TaskDetailDto>().project?.id).toBe(other.id);
      expect(res.json<TaskDetailDto>().event).toBeNull();
    });

    it('a PATCH with a bad pair is 400 and changes nothing', async () => {
      const { g, a, p, e1 } = await setup();
      const other = await project(g.id, a.cookie);
      const task = (await createTask(g.id, a.cookie, { projectId: p.id })).json<TaskDetailDto>();
      const res = await call('PATCH', `/api/tasks/${task.id}`, a.cookie, {
        title: 'Changed',
        projectId: other.id,
        eventId: e1.id,
        updatedAt: task.updatedAt,
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('invalid_project');
      const after = (await call('GET', `/api/tasks/${task.id}`, a.cookie)).json<TaskDetailDto>();
      expect([after.title, after.project?.id]).toEqual(['Budget', p.id]);
    });

    it('a žiadateľ and an outsider get 404', async () => {
      const { g, p } = await setup();
      const ziadatel = await member(g.id, 'ziadatel');
      const outsider = await member((await group()).id);
      for (const who of [ziadatel, outsider]) {
        expect((await createTask(g.id, who.cookie, { projectId: p.id })).statusCode).toBe(404);
      }
    });
  });

  describe('tasks made from a ticket', () => {
    async function ticketOn(groupId: string, cookie: string, projectId: string, eventId: string) {
      const res = await call('POST', '/api/tickets', cookie, {
        groupId,
        subject: 'Report',
        projectId,
        eventId,
      });
      expect(res.statusCode).toBe(201);
      return res.json<TicketDto>();
    }

    it('inherit the ticket’s project and event unless the card says otherwise', async () => {
      const { g, a, p, e1, e2 } = await setup();
      const ticket = await ticketOn(g.id, a.cookie, p.id, e1.id);
      const res = await call('POST', `/api/groups/${g.id}/tasks/from-ticket`, a.cookie, {
        ticketId: ticket.id,
        tasks: [
          { title: 'Inherits' },
          { title: 'Other event', projectId: p.id, eventId: e2.id },
          { title: 'None', projectId: null, eventId: null },
        ],
      });
      expect(res.statusCode).toBe(201);
      const made = res.json<TasksFromMessageResult>().tasks;
      expect(made.map((t) => [t.title, t.project?.id ?? null, t.event?.id ?? null])).toEqual([
        ['Inherits', p.id, e1.id],
        ['Other event', p.id, e2.id],
        ['None', null, null],
      ]);
    });
  });

  describe('board filters', () => {
    async function boardSetup() {
      const s = await setup();
      const mk = (title: string, projectId: string | null, eventId: string | null, done = false) =>
        insertTask(db(), { groupId: s.g.id, createdBy: s.a.id, title, projectId, eventId, done });
      await mk('on e1', s.p.id, s.e1.id);
      await mk('on e2', s.p.id, s.e2.id);
      await mk('on project', s.p.id, null);
      await mk('none', null, null);
      await mk('done on e1', s.p.id, s.e1.id, true);
      await mk('done none', null, null, true);
      return s;
    }
    const titles = (board: BoardDto) => board.tasks.map((t) => t.title).sort();

    it('project, event and none filter the board and the Completed count', async () => {
      const { g, client, p, e1 } = await boardSetup();
      const board = async (q: string) => {
        const res = await call('GET', `/api/groups/${g.id}/board?${q}`, client.cookie);
        expect(res.statusCode).toBe(200);
        return res.json<BoardDto>();
      };
      expect(titles(await board(''))).toHaveLength(6);
      const onProject = await board(`project=${p.id}`);
      expect(titles(onProject)).toEqual(['done on e1', 'on e1', 'on e2', 'on project']);
      expect(onProject.done.total).toBe(1);
      expect(titles(await board(`project=${p.id}&event=${e1.id}`))).toEqual(['done on e1', 'on e1']);
      expect(titles(await board(`project=${p.id}&event=none`))).toEqual(['on project']);
      const none = await board('project=none');
      expect(titles(none)).toEqual(['done none', 'none']);
      expect(none.done.total).toBe(1);
    });

    it('the Completed column’s next page keeps the filter', async () => {
      const { g, a, client, p } = await boardSetup();
      for (let i = 0; i < 16; i++) {
        await insertTask(db(), { groupId: g.id, createdBy: a.id, title: `d${i}`, done: true, projectId: p.id });
      }
      const first = (
        await call('GET', `/api/groups/${g.id}/board?project=${p.id}`, client.cookie)
      ).json<BoardDto>();
      expect(first.done.total).toBe(17);
      const res = await call(
        'GET',
        `/api/groups/${g.id}/board/done?after=${encodeURIComponent(first.done.next!)}&project=none`,
        client.cookie,
      );
      expect(res.statusCode).toBe(200);
      // `project=none` after a page of the project: no task of the project comes.
      expect(res.json<BoardDonePage>().tasks.every((t) => t.project === null)).toBe(true);
      const more = (
        await call(
          'GET',
          `/api/groups/${g.id}/board/done?after=${encodeURIComponent(first.done.next!)}&project=${p.id}`,
          client.cookie,
        )
      ).json<BoardDonePage>();
      expect(more.tasks).toHaveLength(2);
      expect(more.tasks.every((t) => t.project?.id === p.id)).toBe(true);
    });

    it('an event without a project is 400 invalid_filter', async () => {
      const { g, client, e1 } = await boardSetup();
      for (const q of [`event=${e1.id}`, `project=none&event=none`]) {
        const res = await call('GET', `/api/groups/${g.id}/board?${q}`, client.cookie);
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('invalid_filter');
      }
      const done = await call('GET', `/api/groups/${g.id}/board/done?after=a&event=x`, client.cookie);
      expect(done.json().error).toBe('invalid_filter');
    });

    it('the board’s refs are one query whatever the number of projects', async () => {
      const { g, a } = await setup();
      const counting = createCountingDb();
      try {
        await insertTask(db(), { groupId: g.id, createdBy: a.id });
        await getBoard(counting.db, g.id);
        counting.reset();
        await getBoard(counting.db, g.id);
        const without = counting.count();
        for (let i = 0; i < 5; i++) {
          const p = await project(g.id, a.cookie);
          const e = await event(p.id, a.cookie);
          await insertTask(db(), { groupId: g.id, createdBy: a.id, projectId: p.id, eventId: e.id });
          await insertTask(db(), { groupId: g.id, createdBy: a.id, projectId: p.id, done: true });
        }
        counting.reset();
        const board = await getBoard(counting.db, g.id);
        expect(board.tasks.filter((t) => t.event !== null)).toHaveLength(5);
        // One `projectRefs` query for the open tasks and one for the Completed page.
        expect(counting.count()).toBe(without + 2);
      } finally {
        await counting.close();
      }
    });
  });

  describe('global board', () => {
    it('carries the project and filters by it with exactly one client', async () => {
      const { g, a, p, e1 } = await setup();
      await insertTask(db(), { groupId: g.id, createdBy: a.id, title: 'on p', projectId: p.id, eventId: e1.id });
      await insertTask(db(), { groupId: g.id, createdBy: a.id, title: 'plain' });
      const get = (q: string) => call('GET', `/api/tasks/global?${q}`, a.cookie);
      const items = (board: GlobalBoard) => board.columns.flatMap((c) => c.items);
      const all = items((await get(`clients=${g.id}`)).json<GlobalBoard>());
      expect(all.find((t) => t.title === 'on p')?.event?.id).toBe(e1.id);
      const filtered = items((await get(`clients=${g.id}&project=${p.id}`)).json<GlobalBoard>());
      expect(filtered.map((t) => t.title)).toEqual(['on p']);
      expect(filtered[0]!.project).toEqual({ id: p.id, name: p.name, color: p.color });
      const none = items((await get(`clients=${g.id}&project=none`)).json<GlobalBoard>());
      expect(none.map((t) => t.title)).toEqual(['plain']);
      const other = await group();
      for (const q of [`project=${p.id}`, `clients=all&project=${p.id}`, `clients=${g.id},${other.id}&project=${p.id}`]) {
        const res = await get(q);
        expect({ q, status: res.statusCode, error: res.json().error }).toEqual({
          q,
          status: 400,
          error: 'invalid_filter',
        });
      }
    });
  });

  describe('reassignTaskProject', () => {
    it('moves the client’s tasks without an event, leaves others alone', async () => {
      const { g, a, p, e1 } = await setup();
      const into = await project(g.id, a.cookie);
      const plain = await insertTask(db(), { groupId: g.id, createdBy: a.id, projectId: p.id });
      const onEvent = await insertTask(db(), { groupId: g.id, createdBy: a.id, projectId: p.id, eventId: e1.id });
      const elsewhere = await insertTask(db(), { groupId: g.id, createdBy: a.id });
      await db().transaction((tx) => reassignTaskProject(tx, g.id, p.id, into.id));
      const rows = await db().select().from(tasks).where(eq(tasks.groupId, g.id));
      const of = (id: string) => rows.find((r) => r.id === id)!;
      expect(of(plain).projectId).toBe(into.id);
      expect([of(onEvent).projectId, of(onEvent).eventId]).toEqual([p.id, e1.id]);
      expect(of(elsewhere).projectId).toBeNull();
    });
  });
});
