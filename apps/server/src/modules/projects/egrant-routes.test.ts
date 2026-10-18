import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EgrantChangeList, ProjectDto, TicketDto, TicketListResponse } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { insertTask } from '../../../test/tasks.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup, updateGroup } from '../groups/service.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { PROJECTS_INBOX_CLEANUP_JOB } from './jobs.js';
import {
  egrantChanges,
  egrantProjectInbox,
  projectEvents,
  projectNameKeys,
  projects,
} from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

const KEY = 'egrant-project-key-0123456789';
const newEmail = () => `${randomUUID()}@example.com`;
const newHost = () => `p${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;
const pid = () => `prj-${randomUUID().slice(0, 8)}`;

type EventIn = { name: string; date: string; description?: string };
const body = (
  host: string,
  over: Partial<Record<string, unknown>> & { events?: EventIn[] } = {},
) => ({
  instance_url: `https://${host}/`,
  sent_at: '2026-10-17T10:00:00+02:00',
  name: 'Kultúra 2026',
  description: 'Grant na kultúru',
  events: [
    { name: 'Hodnotenie', date: '04.11.2026', description: 'Hodnotenie žiadostí' },
    { name: 'Uzávierka', date: '20.12.2026', description: '' },
  ],
  ...over,
});

describe('eGrant projects (Phase 33 part P3)', () => {
  let test: TestApp;
  const admins: string[] = [];
  let ip = 0;
  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
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
  const deliver = (
    egrantId: string,
    payload: object,
    key: string | null = KEY,
    from = `10.2.${Math.floor(++ip / 250) % 250}.${ip % 250}`,
  ) =>
    test.app.inject({
      method: 'PUT',
      url: `/api/egrant/projects/${encodeURIComponent(egrantId)}`,
      remoteAddress: from,
      headers: key === null ? {} : { authorization: `Bearer ${key}` },
      payload,
    });
  const intake = (payload: object) =>
    test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      remoteAddress: `10.3.${Math.floor(++ip / 250) % 250}.${ip % 250}`,
      headers: { authorization: `Bearer ${KEY}` },
      payload,
    });
  async function client() {
    const host = newHost();
    const g = await createGroup(db(), { name: 'Firma', egrantUrl: `https://${host}` });
    return { ...g, host };
  }
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
  const projectOf = async (groupId: string, egrantId: string) => {
    const [row] = await db()
      .select({ project: projects })
      .from(projectNameKeys)
      .innerJoin(projects, eq(projects.id, projectNameKeys.projectId))
      .where(
        and(
          eq(projectNameKeys.groupId, groupId),
          eq(projectNameKeys.kind, 'egrant_id'),
          eq(projectNameKeys.key, egrantId),
        ),
      );
    return row?.project ?? null;
  };
  const eventsOf = (projectId: string) =>
    db()
      .select()
      .from(projectEvents)
      .where(eq(projectEvents.projectId, projectId))
      .orderBy(projectEvents.occursOn, projectEvents.name);
  const ticketRow = async (id: string) =>
    (await db().select().from(tickets).where(eq(tickets.id, id)))[0]!;
  const changesOf = async (projectId: string, cookie: string) => {
    const res = await call('GET', `/api/projects/${projectId}/egrant-changes`, cookie);
    expect(res.statusCode).toBe(200);
    return res.json<EgrantChangeList>();
  };

  describe('the endpoint is guarded like the ticket intake', () => {
    it('401 without or with a wrong key, before the body is read; 503 when no key is set', async () => {
      const g = await client();
      expect((await deliver(pid(), body(g.host), null)).statusCode).toBe(401);
      expect((await deliver(pid(), body(g.host), 'wrong-key-wrong-key-wrong')).statusCode).toBe(
        401,
      );
      // A body over the limit still answers 401 without the key: the gate runs first.
      const huge = { ...body(g.host), description: 'x'.repeat(1024 * 1024 + 10) };
      expect((await deliver(pid(), huge, null)).statusCode).toBe(401);
      const off = await buildTestApp();
      try {
        const res = await off.app.inject({
          method: 'PUT',
          url: '/api/egrant/projects/prj-1',
          headers: { authorization: `Bearer ${KEY}` },
          payload: body(g.host),
        });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: 'intake_disabled' });
      } finally {
        await off.app.close();
        await off.close();
      }
      const [row] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.groupId, g.id));
      expect(row!.n).toBe(0);
    });

    it('a body over 1 MiB is 413', async () => {
      const g = await client();
      const huge = { ...body(g.host), description: 'x'.repeat(1024 * 1024 + 10) };
      expect((await deliver(pid(), huge)).statusCode).toBe(413);
    });

    it('the 121st call in a minute from one address is 429', async () => {
      const from = '10.250.0.1';
      for (let i = 0; i < 120; i++)
        expect((await deliver(pid(), {}, KEY, from)).statusCode).toBe(400);
      expect((await deliver(pid(), {}, KEY, from)).statusCode).toBe(429);
    });

    it('a malformed field is 400 naming it', async () => {
      const g = await client();
      const bad = await deliver(pid(), { ...body(g.host), sent_at: 'yesterday' });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toEqual({ error: 'validation_failed', fields: ['sent_at'] });
      const longId = await deliver('x'.repeat(101), body(g.host));
      expect(longId.json()).toEqual({ error: 'validation_failed', fields: ['project_id'] });
      const ftp = await deliver(pid(), { ...body(g.host), instance_url: 'ftp://x.sk' });
      expect(ftp.json()).toEqual({ error: 'validation_failed', fields: ['instance_url'] });
      const many = await deliver(pid(), {
        ...body(g.host),
        events: Array.from({ length: 201 }, () => ({ name: 'E', date: '01.01.2026' })),
      });
      expect(many.json()).toEqual({ error: 'validation_failed', fields: ['events'] });
    });
  });

  describe('the first delivery', () => {
    it('creates the project and its valid events "From eGrant"; the same body again is unchanged', async () => {
      const g = await client();
      const id = pid();
      const lines: string[] = [];
      const payload = body(g.host, {
        events: [
          { name: 'Hodnotenie', date: '04.11.2026', description: 'Tajný text' },
          { name: 'Uzávierka', date: '20.12.2026' },
          { name: 'Zlý dátum', date: '31.02.2026', description: 'Tajný text' },
          { name: '  ', date: '01.03.2026' },
          { name: 'Hodnotenie', date: '04.11.2026' },
          { name: 'Iný formát', date: '2026-03-01' },
        ],
      });
      const logged = await buildTestApp({
        config: { ticketsApiKey: KEY },
        logStream: { write: (line) => void lines.push(line) },
      });
      let res;
      try {
        res = await logged.app.inject({
          method: 'PUT',
          url: `/api/egrant/projects/${id}`,
          headers: { authorization: `Bearer ${KEY}` },
          payload,
        });
      } finally {
        await logged.app.close();
        await logged.close();
      }
      expect(res.statusCode).toBe(201);
      expect(res.json()).toEqual({
        project_id: id,
        state: 'created',
        skipped: ['events[2].date', 'events[3].name', 'events[4]', 'events[5].date'],
      });
      const skippedLogs = lines.filter((l) => l.includes('egrant event skipped'));
      expect(skippedLogs).toHaveLength(4);
      expect(skippedLogs.join('')).not.toContain('Tajný');
      expect(skippedLogs.join('')).not.toContain('Zlý');
      const project = (await projectOf(g.id, id))!;
      expect(project).toMatchObject({
        name: 'Kultúra 2026',
        description: 'Grant na kultúru',
        source: 'egrant',
        egrantProjectId: id,
      });
      const events = await eventsOf(project.id);
      expect(events.map((e) => [e.name, e.occursOn, e.source, e.egrantDate])).toEqual([
        ['Hodnotenie', '2026-11-04', 'egrant', '2026-11-04'],
        ['Uzávierka', '2026-12-20', 'egrant', '2026-12-20'],
      ]);
      const again = await deliver(id, payload);
      expect(again.statusCode).toBe(200);
      expect(again.json()).toMatchObject({ state: 'unchanged', pending: 0 });
      expect(await eventsOf(project.id)).toHaveLength(2);
    });

    it('two deliveries at once create one project', async () => {
      const g = await client();
      const id = pid();
      const answers = await Promise.all(Array.from({ length: 5 }, () => deliver(id, body(g.host))));
      expect(answers.filter((a) => a.statusCode === 201)).toHaveLength(1);
      expect(answers.filter((a) => a.statusCode === 200)).toHaveLength(4);
      const [row] = await db()
        .select({ n: sql<number>`count(*)::int` })
        .from(projects)
        .where(eq(projects.groupId, g.id));
      expect(row!.n).toBe(1);
    });

    it('links a person’s project of the same name: its differences become pending', async () => {
      const g = await client();
      const a = await admin();
      const made = await call('POST', `/api/groups/${g.id}/projects`, a.cookie, {
        name: 'kultura  2026',
        description: 'Môj popis',
      });
      expect(made.statusCode).toBe(201);
      const id = pid();
      const res = await deliver(id, body(g.host));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'pending', pending: 4 });
      const project = (await projectOf(g.id, id))!;
      expect(project.id).toBe(made.json<ProjectDto>().id);
      expect(project).toMatchObject({ name: 'kultura  2026', description: 'Môj popis' });
      const list = await changesOf(project.id, a.cookie);
      expect(list.changes.map((c) => c.kind).sort()).toEqual([
        'event_add',
        'event_add',
        'project_description',
        'project_name',
      ]);
    });

    it('keeps one project per client: the same id from another instance is another client’s', async () => {
      const g1 = await client();
      const g2 = await client();
      const id = pid();
      expect((await deliver(id, body(g1.host))).statusCode).toBe(201);
      expect((await deliver(id, body(g2.host, { name: 'Iný' }))).statusCode).toBe(201);
      expect((await projectOf(g1.id, id))!.name).toBe('Kultúra 2026');
      expect((await projectOf(g2.id, id))!.name).toBe('Iný');
    });
  });

  describe('later deliveries', () => {
    async function seeded() {
      const g = await client();
      const a = await admin();
      const id = pid();
      const events: [EventIn, EventIn, EventIn] = [
        { name: 'Hodnotenie', date: '04.11.2026' },
        { name: 'Uzávierka', date: '20.12.2026' },
        { name: 'Kickoff', date: '10.10.2026' },
      ];
      expect((await deliver(id, body(g.host, { events }))).statusCode).toBe(201);
      const project = (await projectOf(g.id, id))!;
      return { g, a, id, project, events };
    }

    it('every kind of change becomes pending; nothing is overwritten', async () => {
      const { g, a, id, project } = await seeded();
      const res = await deliver(
        id,
        body(g.host, {
          sent_at: '2026-10-18T10:00:00+02:00',
          name: 'Kultúra 2026 – nová',
          description: 'Nový popis',
          events: [
            { name: 'Hodnotenie', date: '06.11.2026' }, // redate (by name)
            { name: 'Záverečná uzávierka', date: '20.12.2026' }, // rename (by date)
            { name: 'Kickoff', date: '10.10.2026', description: 'Úvod' }, // description
            { name: 'Workshop', date: '15.01.2027' }, // addition; nothing is removed here
          ],
        }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ state: 'pending', pending: 6, skipped: [] });
      const list = await changesOf(project.id, a.cookie);
      expect(list.changes.map((c) => [c.kind, c.current, c.incoming])).toEqual([
        ['project_name', 'Kultúra 2026', 'Kultúra 2026 – nová'],
        ['project_description', 'Grant na kultúru', 'Nový popis'],
        ['event_description', '', 'Úvod'],
        ['event_date', '2026-11-04', '2026-11-06'],
        ['event_name', 'Uzávierka', 'Záverečná uzávierka'],
        ['event_add', null, { name: 'Workshop', occursOn: '2027-01-15', description: '' }],
      ]);
      expect((await projectOf(g.id, id))!.name).toBe('Kultúra 2026');
      expect((await eventsOf(project.id)).map((e) => [e.name, e.occursOn])).toEqual([
        ['Kickoff', '2026-10-10'],
        ['Hodnotenie', '2026-11-04'],
        ['Uzávierka', '2026-12-20'],
      ]);
      // The project card's badge counts them.
      const dto = await call('GET', `/api/projects/${project.id}`, a.cookie);
      expect(dto.json<ProjectDto>().egrantChanges).toBe(6);
    });

    it('a left-out event is proposed for removal; a person’s own events never are', async () => {
      const { g, a, id, project, events } = await seeded();
      await call('POST', `/api/projects/${project.id}/events`, a.cookie, {
        name: 'Moja porada',
        occursOn: '2026-11-01',
      });
      const res = await deliver(id, body(g.host, { events: events.slice(0, 2) }));
      expect(res.json()).toMatchObject({ state: 'pending', pending: 1 });
      const list = await changesOf(project.id, a.cookie);
      expect(list.changes).toHaveLength(1);
      expect(list.changes[0]).toMatchObject({
        kind: 'event_remove',
        current: { name: 'Kickoff', occursOn: '2026-10-10' },
        incoming: null,
      });
    });

    it('an event renamed and redated at once is an addition plus a removal, shown as maybe the same', async () => {
      const { g, a, id, project, events } = await seeded();
      const res = await deliver(
        id,
        body(g.host, {
          events: [events[1], events[2], { name: 'Hodnotenie žiadostí', date: '06.11.2026' }],
        }),
      );
      expect(res.json()).toMatchObject({ pending: 2 });
      const list = await changesOf(project.id, a.cookie);
      const add = list.changes.find((c) => c.kind === 'event_add')!;
      const remove = list.changes.find((c) => c.kind === 'event_remove')!;
      expect(remove.current).toMatchObject({ name: 'Hodnotenie' });
      expect(list.maybeSame).toEqual([{ addId: add.id, removeId: remove.id }]);
    });

    it('two events of the same name are not paired by name: additions plus removals', async () => {
      const g = await client();
      const a = await admin();
      const id = pid();
      const two = [
        { name: 'Porada', date: '01.11.2026' },
        { name: 'Porada', date: '08.11.2026' },
      ];
      await deliver(id, body(g.host, { events: two }));
      const project = (await projectOf(g.id, id))!;
      const res = await deliver(
        id,
        body(g.host, {
          events: [
            { name: 'Porada', date: '02.11.2026' },
            { name: 'Porada', date: '09.11.2026' },
          ],
        }),
      );
      expect(res.json()).toMatchObject({ pending: 4 });
      const kinds = (await changesOf(project.id, a.cookie)).changes.map((c) => c.kind).sort();
      expect(kinds).toEqual(['event_add', 'event_add', 'event_remove', 'event_remove']);
    });

    it('a person’s rename in Help keeps the pairing (eGrant’s identity is stored)', async () => {
      const { g, a, id, project, events } = await seeded();
      const [hodnotenie] = (await eventsOf(project.id)).filter((e) => e.name === 'Hodnotenie');
      const patched = await call('PATCH', `/api/project-events/${hodnotenie!.id}`, a.cookie, {
        name: 'Hodnotenie (interné)',
        updatedAt: hodnotenie!.updatedAt.toISOString(),
      });
      expect(patched.statusCode).toBe(200);
      // eGrant redates it: still paired by its eGrant name, so a date change and the name back.
      const res = await deliver(
        id,
        body(g.host, {
          events: [{ name: 'Hodnotenie', date: '05.11.2026' }, events[1], events[2]],
        }),
      );
      expect(res.json()).toMatchObject({ pending: 2 });
      const list = await changesOf(project.id, a.cookie);
      expect(list.changes.map((c) => [c.kind, c.eventId])).toEqual([
        ['event_name', hodnotenie!.id],
        ['event_date', hodnotenie!.id],
      ]);
      const [after] = (await eventsOf(project.id)).filter((e) => e.id === hodnotenie!.id);
      expect(after).toMatchObject({ egrantNameKey: 'hodnotenie', egrantDate: '2026-11-05' });
    });

    it('a dismissed value stays dismissed; a newer value is pending again under a new id', async () => {
      const { g, a, id, project, events } = await seeded();
      const renamed = body(g.host, { name: 'Nový názov', events });
      await deliver(id, renamed);
      const [change] = (await changesOf(project.id, a.cookie)).changes;
      const dismissed = await call('POST', `/api/projects/${project.id}/egrant-changes`, a.cookie, {
        dismiss: [change!.id],
      });
      expect(dismissed.statusCode).toBe(200);
      expect(dismissed.json<ProjectDto>().egrantChanges).toBe(0);
      expect((await deliver(id, renamed)).json()).toMatchObject({ state: 'unchanged', pending: 0 });
      // A newer value raises it again, with a new id: a review of the old one is outdated.
      await deliver(id, body(g.host, { name: 'Ešte novší', events }));
      const [fresh] = (await changesOf(project.id, a.cookie)).changes;
      expect(fresh).toMatchObject({ kind: 'project_name', incoming: 'Ešte novší' });
      expect(fresh!.id).not.toBe(change!.id);
      const outdated = await call('POST', `/api/projects/${project.id}/egrant-changes`, a.cookie, {
        accept: [change!.id],
      });
      expect(outdated.statusCode).toBe(409);
      expect(outdated.json()).toEqual({ error: 'change_outdated' });
      // Back to the current value: the row goes.
      await deliver(id, body(g.host, { events }));
      expect((await changesOf(project.id, a.cookie)).changes).toEqual([]);
    });

    it('an older sent_at is stale and changes nothing', async () => {
      const { g, a, id, project } = await seeded();
      const res = await deliver(
        id,
        body(g.host, { sent_at: '2026-10-01T10:00:00Z', name: 'Starý názov', events: [] }),
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ project_id: id, state: 'stale' });
      expect((await changesOf(project.id, a.cookie)).changes).toEqual([]);
    });

    it('an archived project still matches and stays archived', async () => {
      const { g, a, id, project, events } = await seeded();
      await call('POST', `/api/projects/${project.id}/archive`, a.cookie);
      const res = await deliver(id, body(g.host, { name: 'Premenovaný', events }));
      expect(res.json()).toMatchObject({ state: 'pending', pending: 1 });
      expect((await projectOf(g.id, id))!.status).toBe('archived');
    });
  });

  describe('the review', () => {
    it('a client accepts some rows and dismisses others in one save', async () => {
      const g = await client();
      const c = await member(g.id);
      const id = pid();
      const events = [
        { name: 'Hodnotenie', date: '04.11.2026' },
        { name: 'Uzávierka', date: '20.12.2026' },
        { name: 'Kickoff', date: '10.10.2026' },
      ];
      await deliver(id, body(g.host, { events }));
      const project = (await projectOf(g.id, id))!;
      const kickoff = (await eventsOf(project.id)).find((e) => e.name === 'Kickoff')!;
      const ticketOnKickoff = randomUUID();
      const at = new Date();
      await db().insert(tickets).values({
        id: ticketOnKickoff,
        groupId: g.id,
        source: 'manual',
        projectId: project.id,
        eventId: kickoff.id,
        createdAt: at,
        updatedAt: at,
      });
      const later = body(g.host, {
        name: 'Kultúra 2026 (nová)',
        events: [
          { name: 'Hodnotenie', date: '06.11.2026' },
          { name: 'Uzávierka', date: '20.12.2026' },
          { name: 'Workshop', date: '15.01.2027' },
        ],
      });
      await deliver(id, later);
      const list = await changesOf(project.id, c.cookie);
      const of = (kind: string) => list.changes.find((x) => x.kind === kind)!.id;
      const res = await call('POST', `/api/projects/${project.id}/egrant-changes`, c.cookie, {
        accept: [of('project_name'), of('event_date'), of('event_remove')],
        dismiss: [of('event_add')],
      });
      expect(res.statusCode).toBe(200);
      const dto = res.json<ProjectDto>();
      expect(dto).toMatchObject({ name: 'Kultúra 2026 (nová)', egrantChanges: 0 });
      // The old name stays as an alias.
      expect(dto.aliases).toEqual(['kultura 2026']);
      expect((await eventsOf(project.id)).map((e) => [e.name, e.occursOn])).toEqual([
        ['Hodnotenie', '2026-11-06'],
        ['Uzávierka', '2026-12-20'],
      ]);
      // The removed event's ticket keeps the project and loses the event.
      expect(await ticketRow(ticketOnKickoff)).toMatchObject({
        projectId: project.id,
        eventId: null,
      });
      // The same delivery again raises nothing; another date for the dismissed addition does.
      expect((await deliver(id, later)).json()).toMatchObject({ state: 'unchanged' });
      const moved = await deliver(
        id,
        body(g.host, {
          ...later,
          events: [...later.events.slice(0, 2), { name: 'Workshop', date: '16.01.2027' }],
        }),
      );
      expect(moved.json()).toMatchObject({ state: 'pending', pending: 1 });
    });

    it('an admin accepts an addition: a "From eGrant" event; a žiadateľ and an outsider get 404', async () => {
      const g = await client();
      const a = await admin();
      const ziadatel = await member(g.id, 'ziadatel');
      const outsider = await member((await client()).id);
      const id = pid();
      await deliver(id, body(g.host, { events: [] }));
      await deliver(id, body(g.host, { events: [{ name: 'Workshop', date: '15.01.2027' }] }));
      const project = (await projectOf(g.id, id))!;
      for (const who of [ziadatel, outsider]) {
        expect(
          (await call('GET', `/api/projects/${project.id}/egrant-changes`, who.cookie)).statusCode,
        ).toBe(404);
        expect(
          (
            await call('POST', `/api/projects/${project.id}/egrant-changes`, who.cookie, {
              accept: ['x'],
            })
          ).statusCode,
        ).toBe(404);
      }
      const [change] = (await changesOf(project.id, a.cookie)).changes;
      const res = await call('POST', `/api/projects/${project.id}/egrant-changes`, a.cookie, {
        accept: [change!.id],
      });
      expect(res.statusCode).toBe(200);
      const events = await eventsOf(project.id);
      expect(events.map((e) => [e.name, e.source, e.egrantNameKey, e.egrantDate])).toEqual([
        ['Workshop', 'egrant', 'workshop', '2027-01-15'],
      ]);
      expect(
        (await call('POST', `/api/projects/${project.id}/egrant-changes`, a.cookie, {})).statusCode,
      ).toBe(400);
    });

    it('an id of another project’s change is outdated, and nothing is applied', async () => {
      const g = await client();
      const a = await admin();
      const p1 = pid();
      const p2 = pid();
      await deliver(p1, body(g.host, { name: 'Jeden', events: [] }));
      await deliver(p2, body(g.host, { name: 'Dva', events: [] }));
      await deliver(p1, body(g.host, { name: 'Jeden nový', events: [] }));
      await deliver(p2, body(g.host, { name: 'Dva nový', events: [] }));
      const one = (await projectOf(g.id, p1))!;
      const two = (await projectOf(g.id, p2))!;
      const [own] = (await changesOf(one.id, a.cookie)).changes;
      const [foreign] = (await changesOf(two.id, a.cookie)).changes;
      const res = await call('POST', `/api/projects/${one.id}/egrant-changes`, a.cookie, {
        accept: [own!.id, foreign!.id],
      });
      expect(res.statusCode).toBe(409);
      expect((await projectOf(g.id, p1))!.name).toBe('Jeden');
      expect((await projectOf(g.id, p2))!.name).toBe('Dva');
    });
  });

  describe('the inbox: an instance no client has yet', () => {
    it('answers 202 and stores the latest; the client’s creation turns it into the project', async () => {
      const host = newHost();
      const id = pid();
      const first = await deliver(id, body(host, { name: 'Starší' }));
      expect(first.statusCode).toBe(202);
      expect(first.json()).toEqual({ project_id: id, state: 'stored' });
      // An older retry never replaces the newer version.
      await deliver(id, body(host, { name: 'Novší', sent_at: '2026-10-18T10:00:00Z' }));
      await deliver(id, body(host, { name: 'Najstarší', sent_at: '2026-10-01T10:00:00Z' }));
      const g = await createGroup(db(), { name: 'Nová', egrantUrl: `https://www.${host}/app` });
      const project = (await projectOf(g.id, id))!;
      expect(project.name).toBe('Novší');
      expect(await eventsOf(project.id)).toHaveLength(2);
      const stored = await db()
        .select()
        .from(egrantProjectInbox)
        .where(eq(egrantProjectInbox.instanceHost, host));
      expect(stored).toEqual([]);
    });

    it('changing a client’s eGrant URL processes the stored deliveries and links waiting tickets', async () => {
      const g = await client();
      const host = newHost();
      const id = pid();
      expect((await deliver(id, body(host))).statusCode).toBe(202);
      const updated = await updateGroup(db(), g.id, { name: g.name, egrantUrl: `https://${host}` });
      expect(updated).not.toBeNull();
      expect(await projectOf(g.id, id)).not.toBeNull();
    });

    it('the daily cleanup drops stored deliveries older than 180 days', async () => {
      const oldHost = newHost();
      const newer = newHost();
      await deliver(pid(), body(oldHost));
      await deliver(pid(), body(newer));
      await db()
        .update(egrantProjectInbox)
        .set({ receivedAt: new Date(Date.now() - 181 * 24 * 60 * 60 * 1000) })
        .where(eq(egrantProjectInbox.instanceHost, oldHost));
      await test.deps.jobs.send(PROJECTS_INBOX_CLEANUP_JOB, {});
      const left = await db()
        .select({ host: egrantProjectInbox.instanceHost })
        .from(egrantProjectInbox)
        .where(sql`${egrantProjectInbox.instanceHost} in (${oldHost}, ${newer})`);
      expect(left.map((r) => r.host)).toEqual([newer]);
    });
  });

  describe('the ticket intake’s project_id', () => {
    const ticketDto = async (id: string, cookie: string) => {
      const res = await call('GET', `/api/tickets/${id}`, cookie);
      expect(res.statusCode).toBe(200);
      return res.json<TicketDto>();
    };

    it('a known id links the ticket, never with an event; empty or missing means no project', async () => {
      const g = await client();
      const a = await admin();
      const id = pid();
      await deliver(id, body(g.host));
      const project = (await projectOf(g.id, id))!;
      const known = await intake({
        subject: 'x',
        instance_url: `https://${g.host}`,
        project_id: id,
      });
      expect(known.statusCode).toBe(201);
      expect(await ticketRow(known.json<{ id: string }>().id)).toMatchObject({
        projectId: project.id,
        eventId: null,
        egrantProjectId: id,
      });
      const dto = await ticketDto(known.json<{ id: string }>().id, a.cookie);
      expect(dto).toMatchObject({ egrantProjectId: id, waitingForProject: false });
      for (const value of ['', '   ', undefined, null]) {
        const res = await intake({
          subject: 'x',
          instance_url: `https://${g.host}`,
          project_id: value,
        });
        expect(res.statusCode).toBe(201);
        expect(await ticketRow(res.json<{ id: string }>().id)).toMatchObject({
          projectId: null,
          egrantProjectId: null,
        });
      }
      const long = await intake({
        subject: 'x',
        instance_url: `https://${g.host}`,
        project_id: 'x'.repeat(101),
      });
      expect(long.json()).toEqual({ error: 'validation_failed', fields: ['project_id'] });
    });

    it('an unknown id waits and is linked when the project arrives; a žiadateľ never sees it', async () => {
      const g = await client();
      const a = await admin();
      const id = pid();
      const email = newEmail();
      const res = await intake({
        subject: 'x',
        email,
        instance_url: `https://${g.host}`,
        project_id: id,
      });
      const ticketId = res.json<{ id: string }>().id;
      expect(await ticketDto(ticketId, a.cookie)).toMatchObject({
        waitingForProject: true,
        egrantProjectId: id,
        project: null,
      });
      const requester = await loginAs(test.app, email);
      expect(await ticketDto(ticketId, requester)).toMatchObject({
        waitingForProject: false,
        egrantProjectId: null,
        egrantChanges: false,
      });
      expect((await deliver(id, body(g.host))).statusCode).toBe(201);
      const project = (await projectOf(g.id, id))!;
      expect(await ticketRow(ticketId)).toMatchObject({ projectId: project.id, eventId: null });
      expect((await ticketDto(ticketId, a.cookie)).waitingForProject).toBe(false);
    });

    it('never links across clients: another client’s project with that id stays unknown', async () => {
      const mine = await client();
      const other = await client();
      const id = pid();
      await deliver(id, body(other.host));
      const res = await intake({
        subject: 'x',
        instance_url: `https://${mine.host}`,
        project_id: id,
      });
      expect(await ticketRow(res.json<{ id: string }>().id)).toMatchObject({
        groupId: mine.id,
        projectId: null,
        egrantProjectId: id,
      });
    });

    it('a ticket without a client keeps the id and is linked on assignment and on a move', async () => {
      const a = await admin();
      const g1 = await client();
      const g2 = await client();
      const id = pid();
      await deliver(id, body(g1.host));
      await deliver(id, body(g2.host));
      const res = await intake({
        subject: 'x',
        instance_url: 'https://unknown.example.sk',
        project_id: id,
      });
      const ticketId = res.json<{ id: string }>().id;
      expect(await ticketRow(ticketId)).toMatchObject({ groupId: null, egrantProjectId: id });
      expect((await ticketDto(ticketId, a.cookie)).egrantProjectId).toBe(id);
      const assigned = await call('PUT', `/api/tickets/${ticketId}/group`, a.cookie, {
        groupId: g1.id,
      });
      expect(assigned.statusCode).toBe(200);
      const p1 = (await projectOf(g1.id, id))!;
      expect(await ticketRow(ticketId)).toMatchObject({ groupId: g1.id, projectId: p1.id });
      // A hand-set event goes with the move; the raw id matches the new client's project.
      const [event] = await eventsOf(p1.id);
      await db().update(tickets).set({ eventId: event!.id }).where(eq(tickets.id, ticketId));
      const moved = await call('PUT', `/api/tickets/${ticketId}/group`, a.cookie, {
        groupId: g2.id,
      });
      expect(moved.statusCode).toBe(200);
      const p2 = (await projectOf(g2.id, id))!;
      expect(await ticketRow(ticketId)).toMatchObject({
        groupId: g2.id,
        projectId: p2.id,
        eventId: null,
      });
    });

    it('a ticket whose project a person changed is never relinked by a delivery', async () => {
      const g = await client();
      const a = await admin();
      const id = pid();
      const res = await intake({ subject: 'x', instance_url: `https://${g.host}`, project_id: id });
      const ticketId = res.json<{ id: string }>().id;
      const own = await call('POST', `/api/groups/${g.id}/projects`, a.cookie, { name: 'Vlastný' });
      await db()
        .update(tickets)
        .set({ projectId: own.json<ProjectDto>().id })
        .where(eq(tickets.id, ticketId));
      await deliver(id, body(g.host));
      expect((await ticketRow(ticketId)).projectId).toBe(own.json<ProjectDto>().id);
    });

    it('the lists show and filter eGrant changes for admins and clients only', async () => {
      const g = await client();
      const a = await admin();
      const c = await member(g.id);
      const email = newEmail();
      const id = pid();
      await deliver(id, body(g.host));
      const withChanges = await intake({
        subject: 'a',
        email,
        instance_url: `https://${g.host}`,
        project_id: id,
      });
      const without = await intake({ subject: 'b', instance_url: `https://${g.host}` });
      await deliver(id, body(g.host, { name: 'Iný názov' }));
      const changedId = withChanges.json<{ id: string }>().id;
      for (const cookie of [a.cookie, c.cookie]) {
        const all = await call('GET', `/api/groups/${g.id}/tickets`, cookie);
        const items = all.json<TicketListResponse>().items;
        expect(items.find((i) => i.id === changedId)!.egrantChanges).toBe(true);
        expect(items.find((i) => i.id === without.json<{ id: string }>().id)!.egrantChanges).toBe(
          false,
        );
        const filtered = await call('GET', `/api/groups/${g.id}/tickets?egrant=pending`, cookie);
        expect(filtered.json<TicketListResponse>().items.map((i) => i.id)).toEqual([changedId]);
        expect((await ticketDto(changedId, cookie)).egrantChanges).toBe(true);
      }
      const requester = await loginAs(test.app, email);
      const theirs = await call('GET', `/api/groups/${g.id}/tickets`, requester);
      expect(theirs.json<TicketListResponse>().items[0]!.egrantChanges).toBe(false);
      expect(
        (await call('GET', `/api/groups/${g.id}/tickets?egrant=pending`, requester)).statusCode,
      ).toBe(400);
      expect((await ticketDto(changedId, requester)).egrantChanges).toBe(false);
    });

    it('the programme fallback links by name when eGrant sends no project_id', async () => {
      const fallback = await buildTestApp({
        config: { ticketsApiKey: KEY, ticketsProjectField: 'programme' },
      });
      try {
        const g = await client();
        const a = await admin();
        const own = await call('POST', `/api/groups/${g.id}/projects`, a.cookie, {
          name: 'Kultúra 2026',
        });
        const send = (programme: string) =>
          fallback.app.inject({
            method: 'POST',
            url: '/api/tickets/intake',
            headers: { authorization: `Bearer ${KEY}` },
            payload: { subject: 'x', programme, instance_url: `https://${g.host}` },
          });
        const hit = await send('kultura 2026');
        expect((await ticketRow(hit.json<{ id: string }>().id)).projectId).toBe(
          own.json<ProjectDto>().id,
        );
        const miss = await send('Niečo iné');
        expect((await ticketRow(miss.json<{ id: string }>().id)).projectId).toBeNull();
      } finally {
        await fallback.app.close();
        await fallback.close();
      }
    });
  });

  describe('merge', () => {
    it('moves events, tasks, tickets and keys; the merged id keeps matching the survivor', async () => {
      const g = await client();
      const c = await member(g.id);
      const keep = pid();
      const dupe = pid();
      await deliver(keep, body(g.host, { events: [{ name: 'Hodnotenie', date: '04.11.2026' }] }));
      await deliver(
        dupe,
        body(g.host, {
          name: 'Kultúra 2026 (2)',
          events: [{ name: 'Workshop', date: '15.01.2027' }],
        }),
      );
      const into = (await projectOf(g.id, keep))!;
      const from = (await projectOf(g.id, dupe))!;
      const [workshop] = await eventsOf(from.id);
      const onEvent = await insertTask(db(), {
        groupId: g.id,
        createdBy: c.id,
        projectId: from.id,
        eventId: workshop!.id,
      });
      const plain = await insertTask(db(), { groupId: g.id, createdBy: c.id, projectId: from.id });
      const ticket = await intake({
        subject: 'x',
        instance_url: `https://${g.host}`,
        project_id: dupe,
      });
      const ticketId = ticket.json<{ id: string }>().id;
      expect((await ticketRow(ticketId)).projectId).toBe(from.id);

      const res = await call('POST', `/api/projects/${from.id}/merge`, c.cookie, { into: into.id });
      expect(res.statusCode).toBe(200);
      expect(res.json<ProjectDto>().aliases).toEqual(['kultura 2026 (2)']);
      expect((await db().select().from(projects).where(eq(projects.id, from.id))).length).toBe(0);
      expect((await eventsOf(into.id)).map((e) => e.name)).toEqual(['Hodnotenie', 'Workshop']);
      const taskRows = await db()
        .select()
        .from(tasks)
        .where(sql`${tasks.id} in (${onEvent}, ${plain})`);
      expect(taskRows.map((t) => [t.projectId, t.eventId]).sort()).toEqual(
        [
          [into.id, workshop!.id],
          [into.id, null],
        ].sort(),
      );
      expect((await ticketRow(ticketId)).projectId).toBe(into.id);

      // A new ticket with the merged id lands in the survivor; its delivery becomes pending there.
      const next = await intake({
        subject: 'y',
        instance_url: `https://${g.host}`,
        project_id: dupe,
      });
      expect((await ticketRow(next.json<{ id: string }>().id)).projectId).toBe(into.id);
      // The survivor's own id was delivered later: the merged id's older sent_at is not stale.
      await deliver(
        keep,
        body(g.host, {
          sent_at: '2026-10-19T10:00:00Z',
          events: [{ name: 'Hodnotenie', date: '04.11.2026' }],
        }),
      );
      const later = await deliver(
        dupe,
        body(g.host, {
          name: 'Kultúra 2026 (2)',
          events: [{ name: 'Workshop', date: '15.01.2027' }],
        }),
      );
      expect(later.statusCode).toBe(200);
      expect(later.json()).toMatchObject({ state: 'pending' });
      expect(
        (await db().select().from(egrantChanges).where(eq(egrantChanges.projectId, into.id)))
          .length,
      ).toBeGreaterThan(0);
    });

    it('never across clients, never into itself; a žiadateľ gets 404', async () => {
      const g = await client();
      const other = await client();
      const a = await admin();
      const ziadatel = await member(g.id, 'ziadatel');
      const p1 = pid();
      const p2 = pid();
      await deliver(p1, body(g.host, { name: 'A' }));
      await deliver(p2, body(other.host, { name: 'B' }));
      const mine = (await projectOf(g.id, p1))!;
      const theirs = (await projectOf(other.id, p2))!;
      const across = await call('POST', `/api/projects/${mine.id}/merge`, a.cookie, {
        into: theirs.id,
      });
      expect(across.statusCode).toBe(404);
      const self = await call('POST', `/api/projects/${mine.id}/merge`, a.cookie, {
        into: mine.id,
      });
      expect(self.statusCode).toBe(400);
      const z = await call('POST', `/api/projects/${mine.id}/merge`, ziadatel.cookie, {
        into: mine.id,
      });
      expect(z.statusCode).toBe(404);
      expect(await projectOf(g.id, p1)).not.toBeNull();
      expect(await projectOf(other.id, p2)).not.toBeNull();
    });
  });
});
