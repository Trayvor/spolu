import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type {
  EventPickerItem,
  FileInfo,
  ProjectDto,
  ProjectEventDto,
  ProjectPage,
  ProjectPickerItem,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { insertTask } from '../../../test/tasks.js';
import { groupRoom } from '../../infra/realtime/rooms.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { groups } from '../groups/schema.js';
import { projectEvents, projects } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://p${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

describe('projects API', () => {
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
  const group = () => createGroup(db(), { name: 'Firma', egrantUrl: newUrl() });
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
  const upload = (groupId: string, cookie: string) =>
    test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/files`,
      headers: { cookie, 'content-type': 'application/pdf', 'x-file-name': 'plan.pdf' },
      payload: Buffer.from('%PDF-1.4 plan'),
    });
  async function createProject(groupId: string, cookie: string, body: object = {}) {
    const res = await call('POST', `/api/groups/${groupId}/projects`, cookie, {
      name: `Kultúra ${randomUUID().slice(0, 6)}`,
      ...body,
    });
    expect(res.statusCode).toBe(201);
    return res.json<ProjectDto>();
  }
  async function createEvent(projectId: string, cookie: string, body: object = {}) {
    const res = await call('POST', `/api/projects/${projectId}/events`, cookie, {
      name: 'Kickoff',
      occursOn: '2026-11-04',
      ...body,
    });
    expect(res.statusCode).toBe(201);
    return res.json<ProjectEventDto>();
  }
  async function insertTicket(groupId: string, projectId: string | null, eventId: string | null) {
    const id = randomUUID();
    const at = new Date();
    await db()
      .insert(tickets)
      .values({ id, groupId, source: 'manual', projectId, eventId, createdAt: at, updatedAt: at });
    return id;
  }
  /** The `project:changed` emits to the group room while `run` runs. */
  async function projectEmits(groupId: string, run: () => Promise<unknown>) {
    const to = vi.spyOn(test.app.io, 'to');
    try {
      await run();
      return to.mock.calls.filter(([room]) => room === groupRoom(groupId)).length;
    } finally {
      to.mockRestore();
    }
  }

  describe('who reaches what', () => {
    it('a žiadateľ and an outsider get 404 on every route; nothing is written', async () => {
      const g = await group();
      const a = await admin();
      const project = await createProject(g.id, a.cookie);
      const event = await createEvent(project.id, a.cookie);
      const ziadatel = await member(g.id, 'ziadatel');
      const outsider = await member((await group()).id);
      const routes: [Method, string, object?][] = [
        ['GET', `/api/groups/${g.id}/projects`],
        ['GET', `/api/groups/${g.id}/projects/picker`],
        ['POST', `/api/groups/${g.id}/projects`, { name: 'X' }],
        ['GET', `/api/projects/${project.id}`],
        ['PATCH', `/api/projects/${project.id}`, { name: 'Y', updatedAt: project.updatedAt }],
        ['POST', `/api/projects/${project.id}/archive`],
        ['POST', `/api/projects/${project.id}/restore`],
        ['DELETE', `/api/projects/${project.id}/aliases/${encodeURIComponent('stary')}`],
        ['GET', `/api/projects/${project.id}/events/picker`],
        ['POST', `/api/projects/${project.id}/events`, { name: 'E', occursOn: '2026-01-01' }],
        ['GET', `/api/project-events/${event.id}`],
        ['PATCH', `/api/project-events/${event.id}`, { name: 'F', updatedAt: event.updatedAt }],
        ['DELETE', `/api/project-events/${event.id}`],
        ['DELETE', `/api/projects/${project.id}`],
      ];
      for (const who of [ziadatel, outsider]) {
        for (const [method, url, body] of routes) {
          const res = await call(method, url, who.cookie, body);
          expect({ method, url, status: res.statusCode }).toEqual({ method, url, status: 404 });
        }
      }
      expect((await call('GET', `/api/projects/${project.id}`, a.cookie)).json()).toMatchObject({
        name: project.name,
        status: 'active',
      });
      expect((await call('GET', `/api/project-events/${event.id}`, a.cookie)).statusCode).toBe(200);
    });

    it('without a session every route is 401', async () => {
      const g = await group();
      expect((await call('GET', `/api/groups/${g.id}/projects`)).statusCode).toBe(401);
      expect(
        (await call('POST', `/api/groups/${g.id}/projects`, undefined, { name: 'X' })).statusCode,
      ).toBe(401);
    });

    it('unknown ids are 404', async () => {
      const a = await admin();
      expect((await call('GET', `/api/projects/${randomUUID()}`, a.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/project-events/${randomUUID()}`, a.cookie)).statusCode).toBe(
        404,
      );
      expect(
        (await call('POST', `/api/groups/${randomUUID()}/projects`, a.cookie, { name: 'X' }))
          .statusCode,
      ).toBe(404);
    });
  });

  describe('a project’s life (P1 "Done when")', () => {
    it('an admin creates a project with two events and a file; the client sees them, adds a third, archives and restores', async () => {
      const g = await group();
      const a = await admin();
      const file = (await upload(g.id, a.cookie)).json<FileInfo>();
      const project = await createProject(g.id, a.cookie, {
        name: '  Kultúra 2026 ',
        description: 'Výzva na **kultúru**',
        fileIds: [file.id],
      });
      expect(project).toMatchObject({
        groupId: g.id,
        name: 'Kultúra 2026',
        description: 'Výzva na **kultúru**',
        status: 'active',
        source: 'manual',
        aliases: [],
        egrantProjectId: null,
        egrantChanges: 0,
        archivedAt: null,
        createdBy: { id: a.id, name: 'Ad Min' },
      });
      expect(project.files.map((f) => f.id)).toEqual([file.id]);
      await createEvent(project.id, a.cookie, { name: 'Kickoff', occursOn: '2026-03-12' });
      await createEvent(project.id, a.cookie, { name: 'Hodnotenie', occursOn: '2099-11-04' });

      const client = await member(g.id);
      const page = (
        await call('GET', `/api/groups/${g.id}/projects`, client.cookie)
      ).json<ProjectPage>();
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        id: project.id,
        eventCount: 2,
        nextEvent: { name: 'Hodnotenie', occursOn: '2099-11-04' },
        openTasks: 0,
        openTickets: 0,
      });
      // The file is a group file: the client reads it, an outsider does not.
      expect((await call('GET', `/api/files/${file.id}`, client.cookie)).statusCode).toBe(200);
      const outsider = await member((await group()).id);
      expect((await call('GET', `/api/files/${file.id}`, outsider.cookie)).statusCode).toBe(404);

      const third = await createEvent(project.id, client.cookie, {
        name: 'Správa',
        occursOn: '2099-12-20',
      });
      expect(third.createdBy).toEqual({ id: client.id, name: 'Klient' });
      const picker = (
        await call('GET', `/api/projects/${project.id}/events/picker`, client.cookie)
      ).json<EventPickerItem[]>();
      expect(picker.map((e) => e.name)).toEqual(['Kickoff', 'Hodnotenie', 'Správa']);

      const archived = await call('POST', `/api/projects/${project.id}/archive`, client.cookie);
      expect(archived.statusCode).toBe(200);
      expect(archived.json<ProjectDto>()).toMatchObject({ status: 'archived' });
      expect(archived.json<ProjectDto>().archivedAt).not.toBeNull();
      const active = (
        await call('GET', `/api/groups/${g.id}/projects`, client.cookie)
      ).json<ProjectPage>();
      expect(active.items).toEqual([]);
      const old = (
        await call('GET', `/api/groups/${g.id}/projects?status=archived`, client.cookie)
      ).json<ProjectPage>();
      expect(old.items.map((p) => p.id)).toEqual([project.id]);

      const restored = await call('POST', `/api/projects/${project.id}/restore`, client.cookie);
      expect(restored.json<ProjectDto>()).toMatchObject({ status: 'active', archivedAt: null });
    });

    it('a client creates, edits and deletes a project and an event', async () => {
      const g = await group();
      const client = await member(g.id);
      const project = await createProject(g.id, client.cookie, { name: 'Šport' });
      const patched = await call('PATCH', `/api/projects/${project.id}`, client.cookie, {
        description: 'Nový popis',
        updatedAt: project.updatedAt,
      });
      expect(patched.statusCode).toBe(200);
      expect(patched.json<ProjectDto>()).toMatchObject({
        name: 'Šport',
        description: 'Nový popis',
      });

      const event = await createEvent(project.id, client.cookie);
      const moved = await call('PATCH', `/api/project-events/${event.id}`, client.cookie, {
        name: 'Kickoff 2',
        occursOn: '2026-12-01',
        updatedAt: event.updatedAt,
      });
      expect(moved.statusCode).toBe(200);
      expect(moved.json<ProjectEventDto>()).toMatchObject({
        name: 'Kickoff 2',
        occursOn: '2026-12-01',
      });
      expect(
        (await call('DELETE', `/api/project-events/${event.id}`, client.cookie)).statusCode,
      ).toBe(204);
      expect((await call('GET', `/api/project-events/${event.id}`, client.cookie)).statusCode).toBe(
        404,
      );
      expect((await call('DELETE', `/api/projects/${project.id}`, client.cookie)).statusCode).toBe(
        204,
      );
      expect((await call('GET', `/api/projects/${project.id}`, client.cookie)).statusCode).toBe(
        404,
      );
    });

    it('files: added and removed on edit; a removed file is deleted', async () => {
      const g = await group();
      const a = await admin();
      const one = (await upload(g.id, a.cookie)).json<FileInfo>();
      const two = (await upload(g.id, a.cookie)).json<FileInfo>();
      const project = await createProject(g.id, a.cookie, { fileIds: [one.id] });
      const res = await call('PATCH', `/api/projects/${project.id}`, a.cookie, {
        fileIds: [two.id],
        updatedAt: project.updatedAt,
      });
      expect(res.json<ProjectDto>().files.map((f) => f.id)).toEqual([two.id]);
      expect((await call('GET', `/api/files/${one.id}`, a.cookie)).statusCode).toBe(404);

      const event = await createEvent(project.id, a.cookie, { fileIds: [] });
      const three = (await upload(g.id, a.cookie)).json<FileInfo>();
      const withFile = await call('PATCH', `/api/project-events/${event.id}`, a.cookie, {
        fileIds: [three.id],
        updatedAt: event.updatedAt,
      });
      expect(withFile.json<ProjectEventDto>().files.map((f) => f.id)).toEqual([three.id]);
      // A file already attached elsewhere, or of another client, is refused.
      const other = await createProject(g.id, a.cookie);
      expect(
        (
          await call('PATCH', `/api/projects/${other.id}`, a.cookie, {
            fileIds: [two.id],
            updatedAt: other.updatedAt,
          })
        ).json(),
      ).toEqual({ error: 'invalid_attachment' });
      // Deleting the project deletes its files and its events' files.
      expect((await call('DELETE', `/api/projects/${project.id}`, a.cookie)).statusCode).toBe(204);
      expect((await call('GET', `/api/files/${two.id}`, a.cookie)).statusCode).toBe(404);
      expect((await call('GET', `/api/files/${three.id}`, a.cookie)).statusCode).toBe(404);
    });
  });

  describe('validation and conflicts', () => {
    it('400 for a bad body', async () => {
      const g = await group();
      const a = await admin();
      for (const body of [
        {},
        { name: '   ' },
        { name: 'x'.repeat(201) },
        { name: 'A', description: 'x'.repeat(10_001) },
      ]) {
        const res = await call('POST', `/api/groups/${g.id}/projects`, a.cookie, body);
        expect(res.statusCode).toBe(400);
      }
      const project = await createProject(g.id, a.cookie);
      for (const body of [
        { name: 'E', occursOn: '2026-02-31' },
        { name: 'E', occursOn: '04.11.2026' },
        { name: '', occursOn: '2026-01-01' },
      ]) {
        const res = await call('POST', `/api/projects/${project.id}/events`, a.cookie, body);
        expect(res.statusCode).toBe(400);
      }
      expect(
        (await call('PATCH', `/api/projects/${project.id}`, a.cookie, { name: 'B' })).statusCode,
      ).toBe(400);
    });

    it('409 project_changed for a stale updatedAt', async () => {
      const g = await group();
      const a = await admin();
      const project = await createProject(g.id, a.cookie);
      const first = await call('PATCH', `/api/projects/${project.id}`, a.cookie, {
        description: 'one',
        updatedAt: project.updatedAt,
      });
      expect(first.statusCode).toBe(200);
      const stale = await call('PATCH', `/api/projects/${project.id}`, a.cookie, {
        description: 'two',
        updatedAt: project.updatedAt,
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({ error: 'project_changed' });

      const event = await createEvent(project.id, a.cookie);
      await call('PATCH', `/api/project-events/${event.id}`, a.cookie, {
        name: 'A',
        updatedAt: event.updatedAt,
      });
      const staleEvent = await call('PATCH', `/api/project-events/${event.id}`, a.cookie, {
        name: 'B',
        updatedAt: event.updatedAt,
      });
      expect(staleEvent.json()).toEqual({ error: 'project_changed' });
    });

    it('name keys: 409 project_name_taken naming the other project; a rename keeps the old name as an alias', async () => {
      const g = await group();
      const a = await admin();
      const first = await createProject(g.id, a.cookie, { name: 'Kultúra 2026' });
      const dup = await call('POST', `/api/groups/${g.id}/projects`, a.cookie, {
        name: ' kultura   2026',
      });
      expect(dup.statusCode).toBe(409);
      expect(dup.json()).toEqual({ error: 'project_name_taken', name: 'Kultúra 2026' });
      // Another client may use the same name.
      const other = await group();
      expect(
        (await call('POST', `/api/groups/${other.id}/projects`, a.cookie, { name: 'Kultúra 2026' }))
          .statusCode,
      ).toBe(201);

      const renamed = await call('PATCH', `/api/projects/${first.id}`, a.cookie, {
        name: 'Kultúra 2027',
        updatedAt: first.updatedAt,
      });
      expect(renamed.json<ProjectDto>()).toMatchObject({
        name: 'Kultúra 2027',
        aliases: ['kultura 2026'],
      });
      // The alias still blocks the old name for another project …
      expect(
        (
          await call('POST', `/api/groups/${g.id}/projects`, a.cookie, { name: 'Kultúra 2026' })
        ).json(),
      ).toEqual({
        error: 'project_name_taken',
        name: 'Kultúra 2027',
      });
      // … and the current name cannot be removed as an alias.
      const current = await call(
        'DELETE',
        `/api/projects/${first.id}/aliases/${encodeURIComponent('kultura 2027')}`,
        a.cookie,
      );
      expect(current.statusCode).toBe(400);
      // A client removes the alias; the name is free again.
      const client = await member(g.id);
      const removed = await call(
        'DELETE',
        `/api/projects/${first.id}/aliases/${encodeURIComponent('kultura 2026')}`,
        client.cookie,
      );
      expect(removed.statusCode).toBe(200);
      expect(removed.json<ProjectDto>().aliases).toEqual([]);
      expect(
        (await call('POST', `/api/groups/${g.id}/projects`, a.cookie, { name: 'Kultúra 2026' }))
          .statusCode,
      ).toBe(201);
      // Renaming back to an own alias is fine.
      const b = await createProject(g.id, a.cookie, { name: 'Alfa' });
      const toBeta = (
        await call('PATCH', `/api/projects/${b.id}`, a.cookie, {
          name: 'Beta',
          updatedAt: b.updatedAt,
        })
      ).json<ProjectDto>();
      const back = await call('PATCH', `/api/projects/${b.id}`, a.cookie, {
        name: 'alfa',
        updatedAt: toBeta.updatedAt,
      });
      expect(back.statusCode).toBe(200);
      expect(back.json<ProjectDto>()).toMatchObject({ name: 'alfa', aliases: ['beta'] });
    });

    it('an unknown alias is 404', async () => {
      const g = await group();
      const a = await admin();
      const p = await createProject(g.id, a.cookie);
      expect((await call('DELETE', `/api/projects/${p.id}/aliases/nic`, a.cookie)).statusCode).toBe(
        404,
      );
    });
  });

  describe('lists', () => {
    it('pages 30 by name, picker lists every project, counts open tasks and tickets', async () => {
      const g = await group();
      const a = await admin();
      for (let i = 0; i < 32; i++) {
        await db()
          .insert(projects)
          .values({
            id: randomUUID(),
            groupId: g.id,
            name: `P${String(i).padStart(2, '0')}`,
            nameKey: `p${String(i).padStart(2, '0')}`,
          });
      }
      const first = (
        await call('GET', `/api/groups/${g.id}/projects`, a.cookie)
      ).json<ProjectPage>();
      expect(first.items).toHaveLength(30);
      expect(first.items[0]!.name).toBe('P00');
      expect(first.nextCursor).not.toBeNull();
      const second = (
        await call('GET', `/api/groups/${g.id}/projects?after=${first.nextCursor}`, a.cookie)
      ).json<ProjectPage>();
      expect(second.items.map((p) => p.name)).toEqual(['P30', 'P31']);
      expect(second.nextCursor).toBeNull();
      expect(
        (await call('GET', `/api/groups/${g.id}/projects?after=nonsense`, a.cookie)).statusCode,
      ).toBe(400);

      const picker = (await call('GET', `/api/groups/${g.id}/projects/picker`, a.cookie)).json<
        ProjectPickerItem[]
      >();
      expect(picker).toHaveLength(32);
      expect(picker[0]).toMatchObject({ name: 'P00', status: 'active' });
      expect(['purple', 'pink', 'blue', 'coral', 'green']).toContain(picker[0]!.color);

      const target = first.items[0]!;
      await insertTask(db(), { groupId: g.id, createdBy: a.id, projectId: target.id });
      await insertTask(db(), { groupId: g.id, createdBy: a.id, projectId: target.id, done: true });
      await insertTicket(g.id, target.id, null);
      const counted = (
        await call('GET', `/api/groups/${g.id}/projects`, a.cookie)
      ).json<ProjectPage>();
      expect(counted.items[0]).toMatchObject({
        openTasks: 1,
        openTickets: 1,
        eventCount: 0,
        nextEvent: null,
      });
    });
  });

  describe('the database keeps tasks and tickets consistent', () => {
    it('refuses another client’s project, an event of another project and an event without a project', async () => {
      const g = await group();
      const other = await group();
      const a = await admin();
      const mine = await createProject(g.id, a.cookie);
      const theirs = await createProject(other.id, a.cookie);
      const theirEvent = await createEvent(theirs.id, a.cookie);
      const myEvent = await createEvent(mine.id, a.cookie);
      await expect(
        insertTask(db(), { groupId: g.id, createdBy: a.id, projectId: theirs.id }),
      ).rejects.toThrow();
      await expect(
        insertTask(db(), {
          groupId: g.id,
          createdBy: a.id,
          projectId: mine.id,
          eventId: theirEvent.id,
        }),
      ).rejects.toThrow();
      await expect(
        insertTask(db(), { groupId: g.id, createdBy: a.id, eventId: myEvent.id }),
      ).rejects.toThrow();
      await expect(insertTicket(g.id, theirs.id, null)).rejects.toThrow();
      await expect(insertTicket(g.id, mine.id, theirEvent.id)).rejects.toThrow();
      // A ticket without a client never has a project.
      await expect(
        db().insert(tickets).values({
          id: randomUUID(),
          groupId: null,
          source: 'manual',
          projectId: mine.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        }),
      ).rejects.toThrow();
      expect(
        await insertTask(db(), {
          groupId: g.id,
          createdBy: a.id,
          projectId: mine.id,
          eventId: myEvent.id,
        }),
      ).toBeTypeOf('string');
    });

    it('deleting an event clears only the event; deleting a project clears both; tasks and tickets stay', async () => {
      const g = await group();
      const a = await admin();
      const project = await createProject(g.id, a.cookie);
      const one = await createEvent(project.id, a.cookie);
      const two = await createEvent(project.id, a.cookie, { name: 'Two' });
      const t1 = await insertTask(db(), {
        groupId: g.id,
        createdBy: a.id,
        projectId: project.id,
        eventId: one.id,
      });
      const t2 = await insertTask(db(), {
        groupId: g.id,
        createdBy: a.id,
        projectId: project.id,
        eventId: two.id,
      });
      const k1 = await insertTicket(g.id, project.id, one.id);

      expect((await call('DELETE', `/api/project-events/${one.id}`, a.cookie)).statusCode).toBe(
        204,
      );
      const [task1] = await db().select().from(tasks).where(eq(tasks.id, t1));
      expect(task1).toMatchObject({ projectId: project.id, eventId: null });
      const [ticket1] = await db().select().from(tickets).where(eq(tickets.id, k1));
      expect(ticket1).toMatchObject({ projectId: project.id, eventId: null });

      expect((await call('DELETE', `/api/projects/${project.id}`, a.cookie)).statusCode).toBe(204);
      const [task2] = await db().select().from(tasks).where(eq(tasks.id, t2));
      expect(task2).toMatchObject({ groupId: g.id, projectId: null, eventId: null });
      const [ticket2] = await db().select().from(tickets).where(eq(tickets.id, k1));
      expect(ticket2).toMatchObject({ groupId: g.id, projectId: null, eventId: null });
      expect(
        await db().select().from(projectEvents).where(eq(projectEvents.projectId, project.id)),
      ).toEqual([]);
    });

    it('deleting a client deletes its projects with its tasks', async () => {
      const g = await group();
      const a = await admin();
      const project = await createProject(g.id, a.cookie);
      const event = await createEvent(project.id, a.cookie);
      await insertTask(db(), {
        groupId: g.id,
        createdBy: a.id,
        projectId: project.id,
        eventId: event.id,
      });
      await insertTicket(g.id, project.id, event.id);
      await db().delete(groups).where(eq(groups.id, g.id));
      const [row] = [
        ...(await db().execute<{ n: number }>(
          sql`select count(*)::int as n from projects where group_id = ${g.id}`,
        )),
      ];
      expect(row?.n).toBe(0);
    });
  });

  describe('realtime', () => {
    it('every write tells the group room project:changed', async () => {
      const g = await group();
      const a = await admin();
      let project: ProjectDto | undefined;
      expect(
        await projectEmits(g.id, async () => (project = await createProject(g.id, a.cookie))),
      ).toBe(1);
      expect(await projectEmits(g.id, () => createEvent(project!.id, a.cookie))).toBe(1);
      expect(
        await projectEmits(g.id, () =>
          call('POST', `/api/projects/${project!.id}/archive`, a.cookie),
        ),
      ).toBe(1);
      expect(
        await projectEmits(g.id, () => call('DELETE', `/api/projects/${project!.id}`, a.cookie)),
      ).toBe(1);
      // A refused write tells nobody.
      expect(
        await projectEmits(g.id, () => call('POST', `/api/groups/${g.id}/projects`, a.cookie, {})),
      ).toBe(0);
    });
  });

  it('F16: a description naming a client notifies them once, on create and on a later edit', async () => {
    const g = await group();
    const a = await admin();
    const ana = await member(g.id);
    const bea = await member(g.id);
    const mentioned = async (projectId: string) =>
      (
        await db().execute<{ user_id: string }>(sql`
          select user_id from notification_events
          where kind = 'description.mention' and payload->>'subjectId' = ${projectId}`)
      )
        .map((r) => r.user_id)
        .sort();
    const project = await createProject(g.id, a.cookie, { description: `Hi <@${ana.id}>` });
    expect(await mentioned(project.id)).toEqual([ana.id]);
    const res = await call('PATCH', `/api/projects/${project.id}`, a.cookie, {
      description: `Hi <@${ana.id}> and <@${bea.id}>`,
      updatedAt: project.updatedAt,
    });
    expect(res.statusCode).toBe(200);
    expect(await mentioned(project.id)).toEqual([ana.id, bea.id].sort());
  });
});
