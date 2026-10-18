import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  projectColor,
  type ActiveCards,
  type EventItemsPage,
  type ProjectDto,
  type TimelineEventDto,
  type TimelineResponse,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { insertTask } from '../../../test/tasks.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { ticketAssignees, tickets } from '../tickets/schema.js';
import { addAdmin, createUnverifiedClient } from '../users/service.js';
import { projectEvents } from './schema.js';
import { bratislavaDay, getTimeline } from './timeline.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://t${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

/** `today` moved by `days`, `YYYY-MM-DD`. */
function shift(today: string, days: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

describe('the timeline and the active cards (Phase 33 part P4)', () => {
  let test: TestApp;
  const counting = createCountingDb();
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
    await counting.close();
  });

  const db = () => test.deps.db;
  const today = bratislavaDay(new Date());
  const get = (url: string, cookie: string) =>
    test.app.inject({ method: 'GET', url, headers: { cookie } });
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
  async function project(groupId: string, cookie: string, name = 'Kultúra') {
    const res = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/projects`,
      headers: { cookie },
      payload: { name: `${name} ${randomUUID().slice(0, 6)}` },
    });
    expect(res.statusCode).toBe(201);
    return res.json<ProjectDto>();
  }
  let clock = Date.now() - 3_600_000;
  /** An event straight into the table; later calls are created later. */
  async function event(p: ProjectDto, occursOn: string, name = `E ${occursOn}`) {
    const id = randomUUID();
    const at = new Date((clock += 1000));
    await db().insert(projectEvents).values({
      id,
      projectId: p.id,
      groupId: p.groupId,
      name,
      nameKey: name.toLowerCase(),
      occursOn,
      createdAt: at,
      updatedAt: at,
    });
    return id;
  }
  async function ticket(
    groupId: string,
    opts: {
      projectId?: string | null;
      eventId?: string | null;
      status?: 'new' | 'in_progress' | 'resolved';
      subject?: string;
      assignees?: string[];
    } = {},
  ) {
    const id = randomUUID();
    const at = new Date((clock += 1000));
    const status = opts.status ?? 'new';
    await db()
      .insert(tickets)
      .values({
        id,
        groupId,
        source: 'manual',
        status,
        subject: opts.subject ?? 'Otázka',
        projectId: opts.projectId ?? null,
        eventId: opts.eventId ?? null,
        createdAt: at,
        updatedAt: at,
        resolvedAt: status === 'resolved' ? at : null,
      });
    if (opts.assignees?.length) {
      await db()
        .insert(ticketAssignees)
        .values(opts.assignees.map((userId) => ({ ticketId: id, userId })));
    }
    return id;
  }
  const timeline = async (groupId: string, cookie: string, query = '') => {
    const res = await get(`/api/groups/${groupId}/timeline${query}`, cookie);
    expect(res.statusCode).toBe(200);
    return res.json<TimelineResponse>();
  };
  const names = (events: TimelineEventDto[]) => events.map((e) => e.name);

  describe('order and paging', () => {
    it('orders past, today and coming events around today, same day by creation', async () => {
      const g = await group();
      const a = await admin();
      const p = await project(g.id, a.cookie);
      await event(p, shift(today, 5), 'Coming');
      await event(p, shift(today, -10), 'Long ago');
      await event(p, today, 'Today first');
      await event(p, shift(today, -3), 'Recently');
      await event(p, today, 'Today second');
      const page = await timeline(g.id, a.cookie);
      expect(page.today).toBe(today);
      expect(names(page.events)).toEqual([
        'Long ago',
        'Recently',
        'Today first',
        'Today second',
        'Coming',
      ]);
      expect(page.before).toBeNull();
      expect(page.after).toBeNull();
      expect(page.events[0]).toMatchObject({
        project: { id: p.id, name: p.name, color: projectColor(p.id) },
        fromEgrant: false,
        files: 0,
        openTasks: [],
        openTaskCount: 0,
        openTickets: [],
        openTicketCount: 0,
        doneCount: 0,
      });
    });

    it('pages 15 before and 15 from today, then Earlier and Later', async () => {
      const g = await group();
      const a = await admin();
      const p = await project(g.id, a.cookie);
      for (let i = 20; i >= 1; i--) await event(p, shift(today, -i), `past ${i}`);
      for (let i = 0; i < 20; i++) await event(p, shift(today, i), `coming ${i}`);
      const first = await timeline(g.id, a.cookie);
      expect(first.events).toHaveLength(30);
      expect(first.events[0]!.name).toBe('past 15');
      expect(first.events[29]!.name).toBe('coming 14');
      expect(first.before).not.toBeNull();
      expect(first.after).not.toBeNull();

      const earlier = await timeline(g.id, a.cookie, `?before=${first.before}`);
      expect(names(earlier.events)).toEqual([
        'past 20',
        'past 19',
        'past 18',
        'past 17',
        'past 16',
      ]);
      expect(earlier.before).toBeNull();
      const later = await timeline(g.id, a.cookie, `?after=${first.after}`);
      expect(names(later.events)).toEqual([
        'coming 15',
        'coming 16',
        'coming 17',
        'coming 18',
        'coming 19',
      ]);
      expect(later.after).toBeNull();

      // around another day, and a smaller page
      const around = await timeline(g.id, a.cookie, `?around=${shift(today, -18)}&limit=2`);
      expect(names(around.events)).toEqual(['past 20', 'past 19', 'past 18', 'past 17']);

      for (const bad of ['?before=nonsense', `?before=${first.before}&after=${first.after}`]) {
        const res = await get(`/api/groups/${g.id}/timeline${bad}`, a.cookie);
        expect(res.statusCode).toBe(400);
      }
    });

    it('leaves archived projects out of all projects, but shows one when it is chosen', async () => {
      const g = await group();
      const a = await admin();
      const active = await project(g.id, a.cookie, 'Active');
      const archived = await project(g.id, a.cookie, 'Old');
      await event(active, shift(today, 1), 'Active event');
      await event(archived, shift(today, -1), 'Archived event');
      await test.app.inject({
        method: 'POST',
        url: `/api/projects/${archived.id}/archive`,
        headers: { cookie: a.cookie },
      });
      expect(names((await timeline(g.id, a.cookie)).events)).toEqual(['Active event']);
      expect(names((await timeline(g.id, a.cookie, `?project=${archived.id}`)).events)).toEqual([
        'Archived event',
      ]);
      // another client's project gives nothing
      const other = await group();
      const foreign = await project(other.id, a.cookie);
      await event(foreign, today, 'Foreign');
      expect((await timeline(g.id, a.cookie, `?project=${foreign.id}`)).events).toEqual([]);
    });
  });

  describe('rows under an event', () => {
    it('caps the open tasks and tickets at 5, counts them and the done pile', async () => {
      const g = await group();
      const a = await admin();
      const p = await project(g.id, a.cookie);
      const e = await event(p, today, 'Busy');
      const base = { groupId: g.id, createdBy: a.id, projectId: p.id, eventId: e };
      for (let i = 0; i < 6; i++) await insertTask(db(), { ...base, title: `task ${i}` });
      await insertTask(db(), { ...base, title: 'urgent', urgent: true, assignees: [a.id] });
      await insertTask(db(), { ...base, title: 'done 1', done: true });
      await insertTask(db(), { ...base, title: 'done 2', done: true });
      // a task of the project without the event is not under it
      await insertTask(db(), { ...base, eventId: null, title: 'no event' });
      for (let i = 0; i < 6; i++) await ticket(g.id, { projectId: p.id, eventId: e });
      await ticket(g.id, { projectId: p.id, eventId: e, status: 'resolved' });

      const [busy] = (await timeline(g.id, a.cookie)).events;
      expect(busy!.openTasks).toHaveLength(5);
      expect(busy!.openTasks[0]).toMatchObject({
        title: 'urgent',
        urgent: true,
        completedAt: null,
        assignees: [{ id: a.id, name: 'Ad Min' }],
      });
      expect(busy!.openTaskCount).toBe(7);
      expect(busy!.openTickets).toHaveLength(5);
      expect(busy!.openTicketCount).toBe(6);
      expect(busy!.doneCount).toBe(3);
    });

    it('reads a page in a fixed number of queries, however many events it has', async () => {
      const g = await group();
      const a = await admin();
      const p = await project(g.id, a.cookie);
      const one = await event(p, today);
      await insertTask(db(), {
        groupId: g.id,
        createdBy: a.id,
        projectId: p.id,
        eventId: one,
        assignees: [a.id],
      });
      await getTimeline(counting.db, g.id, { around: 'today', limit: 15 }); // warms the pool
      counting.reset();
      await getTimeline(counting.db, g.id, { around: 'today', limit: 15 });
      const small = counting.count();

      const other = await project(g.id, a.cookie);
      for (let i = -15; i < 15; i++) {
        const e = await event(other, shift(today, i));
        await insertTask(db(), {
          groupId: g.id,
          createdBy: a.id,
          projectId: other.id,
          eventId: e,
          assignees: [a.id],
        });
        await ticket(g.id, { projectId: other.id, eventId: e });
      }
      counting.reset();
      const page = await getTimeline(counting.db, g.id, { around: 'today', limit: 15 });
      expect(page.events).toHaveLength(30);
      expect(counting.count()).toBe(small);
      expect(counting.count()).toBeLessThanOrEqual(6);
    });

    it('pages the sheet’s lists and the done pile', async () => {
      const g = await group();
      const a = await admin();
      const p = await project(g.id, a.cookie);
      const e = await event(p, today);
      const base = { groupId: g.id, createdBy: a.id, projectId: p.id, eventId: e };
      for (let i = 0; i < 23; i++) await insertTask(db(), { ...base, title: `t${i}` });
      for (let i = 0; i < 12; i++) await insertTask(db(), { ...base, done: true });
      for (let i = 0; i < 12; i++) await ticket(g.id, { ...base, status: 'resolved' });
      await ticket(g.id, { ...base, subject: 'open one' });

      const items = (query: string) =>
        get(`/api/project-events/${e}/items${query}`, a.cookie).then((r) => {
          expect(r.statusCode).toBe(200);
          return r.json<EventItemsPage>();
        });
      const first = await items('?kind=tasks');
      expect(first.tasks).toHaveLength(20);
      expect(first.tickets).toEqual([]);
      const second = await items(`?kind=tasks&after=${first.nextCursor}`);
      expect(second.tasks).toHaveLength(3);
      expect(second.nextCursor).toBeNull();
      const all = [...first.tasks, ...second.tasks].map((t) => t.title);
      expect(new Set(all).size).toBe(23);

      const tickets = await items('?kind=tickets');
      expect(tickets.tickets.map((t) => t.subject)).toEqual(['open one']);

      const done1 = await items('?kind=done');
      expect(done1.tasks.length + done1.tickets.length).toBe(20);
      const done2 = await items(`?kind=done&after=${done1.nextCursor}`);
      expect(done2.tasks.length + done2.tickets.length).toBe(4);
      expect(done2.nextCursor).toBeNull();
      const ids = [...done1.tasks, ...done1.tickets, ...done2.tasks, ...done2.tickets].map(
        (r) => r.id,
      );
      expect(new Set(ids).size).toBe(24);
      expect([...done1.tasks, ...done2.tasks].every((t) => t.completedAt !== null)).toBe(true);

      expect(
        (await get(`/api/project-events/${e}/items?kind=done&after=xyz`, a.cookie)).statusCode,
      ).toBe(400);
      expect((await get(`/api/project-events/${e}/items?kind=nope`, a.cookie)).statusCode).toBe(
        400,
      );
    });
  });

  describe('who reaches it', () => {
    it('the group’s client reads it; a žiadateľ and an outsider get 404', async () => {
      const g = await group();
      const a = await admin();
      const p = await project(g.id, a.cookie);
      const e = await event(p, today);
      const client = await member(g.id);
      const ziadatel = await member(g.id, 'ziadatel');
      const outsider = await member((await group()).id);
      const urls = [
        `/api/groups/${g.id}/timeline`,
        `/api/project-events/${e}/items?kind=tasks`,
        `/api/groups/${g.id}/overview/active`,
      ];
      for (const url of urls) {
        expect((await get(url, client.cookie)).statusCode).toBe(200);
        expect((await get(url, ziadatel.cookie)).statusCode).toBe(404);
        expect((await get(url, outsider.cookie)).statusCode).toBe(404);
      }
      expect((await get(`/api/groups/${randomUUID()}/timeline`, a.cookie)).statusCode).toBe(404);
      expect(
        (await get(`/api/project-events/${randomUUID()}/items?kind=done`, a.cookie)).statusCode,
      ).toBe(404);
    });
  });

  describe('the active cards', () => {
    it('lists open tasks and active tickets with mine first, and their totals', async () => {
      const g = await group();
      const a = await admin();
      const client = await member(g.id);
      const p = await project(g.id, a.cookie);
      const e = await event(p, today, 'Hodnotenie');
      const base = { groupId: g.id, createdBy: a.id };
      await insertTask(db(), { ...base, title: 'urgent other', urgent: true });
      await insertTask(db(), {
        ...base,
        title: 'mine',
        assignees: [a.id],
        projectId: p.id,
        eventId: e,
      });
      await insertTask(db(), { ...base, title: 'clients', assignees: [client.id] });
      await insertTask(db(), { ...base, title: 'due', dueDate: shift(today, 2) });
      await insertTask(db(), { ...base, title: 'completed', done: true, assignees: [a.id] });
      await ticket(g.id, { subject: 'old other' });
      await ticket(g.id, { subject: 'mine', assignees: [a.id], projectId: p.id });
      await ticket(g.id, { subject: 'clients', assignees: [client.id], status: 'in_progress' });
      await ticket(g.id, { subject: 'new other' });
      await ticket(g.id, { subject: 'resolved', status: 'resolved', assignees: [a.id] });

      const cards = (
        await get(`/api/groups/${g.id}/overview/active`, a.cookie)
      ).json<ActiveCards>();
      expect(cards.tasks.rows.map((t) => t.title)).toEqual([
        'mine',
        'urgent other',
        'due',
        'clients',
      ]);
      expect(cards.tasks).toMatchObject({ total: 4, mine: 1, urgent: 1 });
      expect(cards.tasks.rows[0]).toMatchObject({
        mine: true,
        assignees: [{ id: a.id, name: 'Ad Min' }],
        project: { id: p.id, name: p.name, color: projectColor(p.id) },
        event: { id: e, name: 'Hodnotenie', occursOn: today },
      });
      expect(cards.tickets.rows.map((t) => t.subject)).toEqual([
        'mine',
        'new other',
        'clients',
        'old other',
      ]);
      expect(cards.tickets).toMatchObject({ total: 4, mine: 1 });
      expect(cards.tickets.rows[0]!.project).toMatchObject({ id: p.id });

      const theirs = (
        await get(`/api/groups/${g.id}/overview/active`, client.cookie)
      ).json<ActiveCards>();
      expect(theirs.tasks.rows[0]!.title).toBe('clients');
      expect(theirs.tickets.rows[0]!.subject).toBe('clients');
    });

    it('caps each card at 8 rows in a fixed number of queries', async () => {
      const g = await group();
      const a = await admin();
      for (let i = 0; i < 10; i++) {
        await insertTask(db(), { groupId: g.id, createdBy: a.id, assignees: [a.id] });
        await ticket(g.id, { assignees: [a.id] });
      }
      const cards = (
        await get(`/api/groups/${g.id}/overview/active`, a.cookie)
      ).json<ActiveCards>();
      expect(cards.tasks.rows).toHaveLength(8);
      expect(cards.tasks.total).toBe(10);
      expect(cards.tickets.rows).toHaveLength(8);
      expect(cards.tickets.total).toBe(10);
      const { getActiveCards } = await import('./overview.js');
      await getActiveCards(counting.db, g.id, a.id); // warms the pool
      counting.reset();
      await getActiveCards(counting.db, g.id, a.id);
      expect(counting.count()).toBeLessThanOrEqual(4);
    });
  });
});
