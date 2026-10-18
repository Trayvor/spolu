import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectDto, ProjectEventDto, TicketDto, TicketListResponse } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { reassignTicketProject } from './project-links.js';
import { tickets } from './schema.js';
import { listTickets } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://k${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

/** Phase 33 part P2: tickets on projects and events, and the list filters. */
describe('tickets on projects', () => {
  let test: TestApp;
  const admins: string[] = [];
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
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
  const group = () =>
    createGroup(db(), { name: `Firma ${randomUUID().slice(0, 6)}`, egrantUrl: newUrl() });
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel' = 'client') {
    const c = await createUnverifiedClient(db(), newEmail(), 'Klient');
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  async function project(groupId: string, cookie: string) {
    const res = await call('POST', `/api/groups/${groupId}/projects`, cookie, {
      name: `Kultúra ${randomUUID().slice(0, 6)}`,
    });
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
  async function insertTicket(
    groupId: string | null,
    over: Partial<typeof tickets.$inferInsert> = {},
  ): Promise<string> {
    const id = randomUUID();
    const at = new Date();
    await db()
      .insert(tickets)
      .values({
        id,
        groupId,
        source: 'manual',
        subject: 'Otázka',
        createdAt: at,
        updatedAt: at,
        ...over,
      });
    return id;
  }
  async function setup() {
    const g = await group();
    const a = await admin();
    const client = await member(g.id);
    const p = await project(g.id, a.cookie);
    const e1 = await event(p.id, a.cookie, 'Kickoff');
    const e2 = await event(p.id, a.cookie, 'Final report');
    return { g, a, client, p, e1, e2 };
  }
  const setProject = (id: string, cookie: string, body: object) =>
    call('PUT', `/api/tickets/${id}/project`, cookie, body);

  describe('PUT /api/tickets/:id/project', () => {
    it('a client and an admin set, change and clear it', async () => {
      const { g, a, client, p, e1, e2 } = await setup();
      const id = await insertTicket(g.id);
      let res = await setProject(id, client.cookie, { projectId: p.id, eventId: e1.id });
      expect(res.statusCode).toBe(200);
      expect(res.json<TicketDto>().project).toEqual({ id: p.id, name: p.name, color: p.color });
      expect(res.json<TicketDto>().event).toEqual({
        id: e1.id,
        name: 'Kickoff',
        occursOn: '2026-11-04',
      });
      res = await setProject(id, a.cookie, { projectId: p.id, eventId: e2.id });
      expect(res.json<TicketDto>().event?.id).toBe(e2.id);
      res = await setProject(id, client.cookie, { projectId: p.id });
      expect([res.json<TicketDto>().project?.id, res.json<TicketDto>().event]).toEqual([
        p.id,
        null,
      ]);
      res = await setProject(id, client.cookie, { projectId: null });
      expect([res.json<TicketDto>().project, res.json<TicketDto>().event]).toEqual([null, null]);
      const [row] = await db().select().from(tickets).where(eq(tickets.id, id));
      expect([row!.projectId, row!.eventId]).toEqual([null, null]);
    });

    it('a žiadateľ (even on their own ticket) and an outsider get 404', async () => {
      const { g, p } = await setup();
      const ziadatel = await member(g.id, 'ziadatel');
      const outsider = await member((await group()).id);
      const id = await insertTicket(g.id, { requesterUserId: ziadatel.id });
      for (const who of [ziadatel, outsider]) {
        expect((await setProject(id, who.cookie, { projectId: p.id })).statusCode).toBe(404);
      }
      const [row] = await db().select().from(tickets).where(eq(tickets.id, id));
      expect(row!.projectId).toBeNull();
    });

    it('a client still may not edit the other fields', async () => {
      const { g, client } = await setup();
      const id = await insertTicket(g.id);
      const res = await call('PATCH', `/api/tickets/${id}`, client.cookie, { subject: 'New' });
      expect(res.statusCode).toBe(403);
    });

    it('a pair that does not fit is 400 invalid_project; a ticket without a client 409', async () => {
      const { g, a, p, e1 } = await setup();
      const other = await project(g.id, a.cookie);
      const foreign = await project((await group()).id, a.cookie);
      const id = await insertTicket(g.id);
      for (const body of [
        { projectId: foreign.id },
        { projectId: other.id, eventId: e1.id },
        { projectId: null, eventId: e1.id },
      ]) {
        const res = await setProject(id, a.cookie, body);
        expect({ body, status: res.statusCode, error: res.json().error }).toEqual({
          body,
          status: 400,
          error: 'invalid_project',
        });
      }
      expect((await setProject(id, a.cookie, {})).statusCode).toBe(400);
      const orphan = await insertTicket(null);
      const res = await setProject(orphan, a.cookie, { projectId: p.id });
      expect(res.statusCode).toBe(409);
      expect(res.json().error).toBe('no_client');
    });
  });

  describe('what a žiadateľ sees', () => {
    it('the project’s name only: no colour, no event, on the page and in the list', async () => {
      const { g, p, e1 } = await setup();
      const ziadatel = await member(g.id, 'ziadatel');
      const id = await insertTicket(g.id, {
        requesterUserId: ziadatel.id,
        projectId: p.id,
        eventId: e1.id,
      });
      const dto = (await call('GET', `/api/tickets/${id}`, ziadatel.cookie)).json<TicketDto>();
      expect([dto.project, dto.event]).toEqual([{ id: p.id, name: p.name, color: null }, null]);
      for (const url of [`/api/groups/${g.id}/tickets`, '/api/tickets/mine']) {
        const list = (await call('GET', url, ziadatel.cookie)).json<TicketListResponse>();
        const item = list.items.find((i) => i.id === id)!;
        expect({ url, project: item.project, event: item.event }).toEqual({
          url,
          project: { id: p.id, name: p.name, color: null },
          event: null,
        });
      }
    });
  });

  describe('new tickets', () => {
    it('a client creates a ticket on an event; a bad pair is 400 and nothing is written', async () => {
      const { g, a, client, p, e1 } = await setup();
      const res = await call('POST', '/api/tickets', client.cookie, {
        groupId: g.id,
        subject: 'On event',
        projectId: p.id,
        eventId: e1.id,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<TicketDto>().event?.id).toBe(e1.id);
      const foreign = await project((await group()).id, a.cookie);
      const bad = await call('POST', '/api/tickets', a.cookie, {
        groupId: g.id,
        subject: 'Bad pair',
        projectId: foreign.id,
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toBe('invalid_project');
      const rows = await db().select().from(tickets).where(eq(tickets.groupId, g.id));
      expect(rows.some((r) => r.subject === 'Bad pair')).toBe(false);
    });
  });

  describe('moving a ticket', () => {
    it('to another client clears its project and event', async () => {
      const { g, a, p, e1 } = await setup();
      const id = await insertTicket(g.id, { projectId: p.id, eventId: e1.id });
      const other = await group();
      const res = await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: other.id });
      expect(res.statusCode).toBe(200);
      expect([res.json<TicketDto>().project, res.json<TicketDto>().event]).toEqual([null, null]);
    });
  });

  describe('list filters', () => {
    async function listSetup() {
      const s = await setup();
      const mk = (subject: string, projectId: string | null, eventId: string | null) =>
        insertTicket(s.g.id, { subject, projectId, eventId });
      await mk('on e1', s.p.id, s.e1.id);
      await mk('on e2', s.p.id, s.e2.id);
      await mk('on project', s.p.id, null);
      await mk('none', null, null);
      return s;
    }
    const subjects = (list: TicketListResponse) => list.items.map((i) => i.subject).sort();

    it('the group tab filters by project, event and none', async () => {
      const { g, client, p, e1 } = await listSetup();
      const list = async (q: string) => {
        const res = await call('GET', `/api/groups/${g.id}/tickets?${q}`, client.cookie);
        expect(res.statusCode).toBe(200);
        return res.json<TicketListResponse>();
      };
      const all = await list('');
      expect(subjects(all)).toHaveLength(4);
      expect(all.items.find((i) => i.subject === 'on e1')!.event?.id).toBe(e1.id);
      expect(subjects(await list(`project=${p.id}`))).toEqual(['on e1', 'on e2', 'on project']);
      expect(subjects(await list(`project=${p.id}&event=${e1.id}`))).toEqual(['on e1']);
      expect(subjects(await list(`project=${p.id}&event=none`))).toEqual(['on project']);
      expect(subjects(await list('project=none'))).toEqual(['none']);
      const bad = await call('GET', `/api/groups/${g.id}/tickets?event=${e1.id}`, client.cookie);
      expect(bad.statusCode).toBe(400);
      expect(bad.json().error).toBe('invalid_filter');
    });

    it('the global list takes a project only with exactly one client', async () => {
      const { g, a, p } = await listSetup();
      const ok = await call('GET', `/api/tickets/global?clients=${g.id}&project=${p.id}`, a.cookie);
      expect(ok.statusCode).toBe(200);
      expect(subjects(ok.json<TicketListResponse>())).toEqual(['on e1', 'on e2', 'on project']);
      const other = await group();
      for (const q of [
        `project=${p.id}`,
        `scope=all&project=${p.id}`,
        `clients=${g.id},${other.id}&project=${p.id}`,
        `clients=${g.id}&project=${p.id}&event=none`,
      ]) {
        const res = await call('GET', `/api/tickets/global?${q}`, a.cookie);
        expect({ q, status: res.statusCode }).toEqual({ q, status: 400 });
      }
      const mine = await call('GET', `/api/tickets/mine?project=${p.id}`, a.cookie);
      expect(mine.statusCode).toBe(400);
    });

    it('the refs of a page are one query whatever the number of projects', async () => {
      const { g, a } = await setup();
      const counting = createCountingDb();
      try {
        await insertTicket(g.id);
        const source = { kind: 'group' as const, groupId: g.id, role: null };
        const query = { status: 'open' as const, scope: 'mine' as const };
        const viewer = { ...a, finance: false };
        counting.reset();
        await listTickets(counting.db, viewer, source, query);
        const without = counting.count();
        for (let i = 0; i < 4; i++) {
          const p = await project(g.id, a.cookie);
          const e = await event(p.id, a.cookie);
          await insertTicket(g.id, { projectId: p.id, eventId: e.id });
        }
        counting.reset();
        const page = await listTickets(counting.db, viewer, source, query);
        expect(page.items.filter((i) => i.event !== null)).toHaveLength(4);
        expect(counting.count()).toBe(without + 1);
      } finally {
        await counting.close();
      }
    });
  });

  describe('reassignTicketProject', () => {
    it('moves the client’s tickets without an event, leaves others alone', async () => {
      const { g, a, p, e1 } = await setup();
      const into = await project(g.id, a.cookie);
      const plain = await insertTicket(g.id, { projectId: p.id });
      const onEvent = await insertTicket(g.id, { projectId: p.id, eventId: e1.id });
      const elsewhere = await insertTicket(g.id);
      await db().transaction((tx) => reassignTicketProject(tx, g.id, p.id, into.id));
      const rows = await db().select().from(tickets).where(eq(tickets.groupId, g.id));
      const of = (id: string) => rows.find((r) => r.id === id)!;
      expect(of(plain).projectId).toBe(into.id);
      expect([of(onEvent).projectId, of(onEvent).eventId]).toEqual([p.id, e1.id]);
      expect(of(elsewhere).projectId).toBeNull();
    });
  });
});
