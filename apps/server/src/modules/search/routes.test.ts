import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SearchResults, SessionUser } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpToken } from '../../../test/mcp.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { normalizeSearch } from '../../infra/text/search.js';
import { financeItems } from '../finance/schema.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup, setGroupDeactivated } from '../groups/service.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { createEvent, createProject } from '../projects/service.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';
import { search } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
/** A word no other test writes: letters only, so it is never read as a ticket number. */
const word = () =>
  `zq${Array.from({ length: 8 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
const host = () => `s${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('global search (GET /api/search)', () => {
  let test: TestApp;
  const admins: string[] = [];
  const db = () => test.deps.db;
  const get = (url: string, cookie?: string) =>
    test.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });
  const find = async (cookie: string, q: string, extra = '') => {
    const res = await get(`/api/search?q=${encodeURIComponent(q)}${extra}`, cookie);
    expect(res.statusCode).toBe(200);
    return res.json<SearchResults>();
  };
  /** Every id in the answer, whatever its type. */
  const allIds = (r: SearchResults) =>
    Object.values(r).flatMap((hits: { id: string }[]) => hits.map((h) => h.id));

  async function admin(finance = false) {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    if (finance) await setFinanceAccess(db(), a.id, a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function person(name: string, groupId: string, role: 'client' | 'ziadatel') {
    const email = newEmail();
    const id = randomUUID();
    await db().insert(user).values({ id, email, name, role: 'client', emailVerified: true });
    await addMembership(db(), id, groupId, role);
    return { id, email, cookie: await loginAs(test.app, email) };
  }
  async function ticket(groupId: string | null, subject: string, requesterUserId: string | null) {
    const now = new Date();
    const [row] = await db()
      .insert(tickets)
      .values({
        id: randomUUID(),
        groupId,
        source: 'manual',
        subject,
        requesterUserId,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: tickets.id, number: tickets.number });
    return row!;
  }
  async function note(groupId: string, title: string, createdBy: string, visibility = 'public') {
    const id = randomUUID();
    await db()
      .insert(knowledgeItems)
      .values({
        id,
        groupId,
        type: 'note',
        visibility,
        title,
        createdBy,
        searchText: normalizeSearch(title),
      });
    return id;
  }
  async function task(cookie: string, groupId: string, title: string) {
    const res = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/tasks`,
      headers: { cookie },
      payload: { title, assigneeIds: [] },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(db(), id);
    await test.app.close();
    await test.close();
  });

  describe('the leak matrix', () => {
    const w = word();
    let ids: Record<string, string>;
    let s: {
      admin: Awaited<ReturnType<typeof admin>>;
      finance: Awaited<ReturnType<typeof admin>>;
      clientA: Awaited<ReturnType<typeof person>>;
      clientB: Awaited<ReturnType<typeof person>>;
      requester: Awaited<ReturnType<typeof person>>;
    };

    beforeAll(async () => {
      const a = await createGroup(db(), {
        name: `Obec ${w} Lúky`,
        egrantUrl: `https://${host()}.egrant.sk`,
      });
      const b = await createGroup(db(), {
        name: `Mesto ${w} Iné`,
        egrantUrl: `https://${host()}.egrant.sk`,
      });
      const team = await ensureAdminGroup(db());
      s = {
        admin: await admin(),
        finance: await admin(true),
        clientA: await person(`Jana ${w}`, a.id, 'client'),
        clientB: await person(`Peter ${w}`, b.id, 'client'),
        requester: await person(`Žofia ${w}`, a.id, 'ziadatel'),
      };
      const by = s.admin.id;
      const project = await createProject(db(), by, a.id, {
        name: `Projekt ${w} A`,
        description: '',
        fileIds: [],
      });
      const projectB = await createProject(db(), by, b.id, {
        name: `Projekt ${w} B`,
        description: '',
        fileIds: [],
      });
      const event = await createEvent(db(), by, project.id, {
        name: `Kontrola ${w}`,
        occursOn: '2026-11-02',
        description: '',
        fileIds: [],
      });
      const financeId = randomUUID();
      await db()
        .insert(financeItems)
        .values({
          id: financeId,
          groupId: a.id,
          type: 'note',
          title: `Zmluva ${w}`,
          createdBy: by,
          searchText: normalizeSearch(`Zmluva ${w}`),
        });
      ids = {
        groupA: a.id,
        groupB: b.id,
        ticketOwn: (await ticket(a.id, `Chyba ${w} moja`, s.requester.id)).id,
        ticketA: (await ticket(a.id, `Chyba ${w} cudzia`, null)).id,
        ticketB: (await ticket(b.id, `Chyba ${w} B`, null)).id,
        ticketNone: (await ticket(null, `Chyba ${w} bez klienta`, null)).id,
        taskA: await task(s.admin.cookie, a.id, `Úloha ${w} A`),
        taskB: await task(s.admin.cookie, b.id, `Úloha ${w} B`),
        taskTeam: await task(s.admin.cookie, team, `Úloha ${w} tím`),
        noteA: await note(a.id, `Poznámka ${w} A`, by),
        noteAdminsOnly: await note(a.id, `Poznámka ${w} interná`, by, 'admins'),
        noteB: await note(b.id, `Poznámka ${w} B`, by),
        noteTeam: await note(team, `Poznámka ${w} tím`, by),
        projectA: project.id,
        projectB: projectB.id,
        eventA: event.id,
        finance: financeId,
      };
    });

    it('a client finds only their own group, its tickets, tasks, public knowledge and projects', async () => {
      const r = await find(s.clientA.cookie, w);
      expect(r.groups?.map((h) => h.id)).toEqual([ids.groupA]);
      expect(r.tickets?.map((h) => h.id).sort()).toEqual([ids.ticketOwn, ids.ticketA].sort());
      expect(r.tasks?.map((h) => h.id)).toEqual([ids.taskA]);
      expect(r.knowledge?.map((h) => h.id)).toEqual([ids.noteA]);
      expect(r.projects?.map((h) => h.id).sort()).toEqual([ids.projectA, ids.eventA].sort());
      // No people for clients, not even an empty list.
      expect(r.people).toBeUndefined();
      expect((await find(s.clientA.cookie, w, '&types=people')).people).toBeUndefined();
    });

    it('a client never sees another client’s items', async () => {
      const r = await find(s.clientB.cookie, w);
      const found = allIds(r);
      for (const key of [
        'groupA',
        'ticketOwn',
        'ticketA',
        'taskA',
        'noteA',
        'projectA',
        'eventA',
      ]) {
        expect(found).not.toContain(ids[key]);
      }
      expect(found).toEqual(
        expect.arrayContaining([ids.groupB, ids.ticketB, ids.taskB, ids.noteB, ids.projectB]),
      );
      // Nothing of the admin group and no ticket without a client.
      expect(found).not.toContain(ids.taskTeam);
      expect(found).not.toContain(ids.noteTeam);
      expect(found).not.toContain(ids.ticketNone);
    });

    it('a ziadatel finds only the tickets they started', async () => {
      const r = await find(s.requester.cookie, w);
      expect(r.tickets?.map((h) => h.id)).toEqual([ids.ticketOwn]);
      expect(allIds(r)).toEqual([ids.ticketOwn]);
    });

    it('admins-only knowledge never reaches clients; admins find it', async () => {
      for (const who of [s.clientA, s.clientB, s.requester]) {
        expect(allIds(await find(who.cookie, `${w} interná`))).not.toContain(ids.noteAdminsOnly);
      }
      const r = await find(s.admin.cookie, `${w} interna`);
      expect(r.knowledge?.map((h) => h.id)).toEqual([ids.noteAdminsOnly]);
    });

    it('an admin finds everything they read, people too; finance never appears', async () => {
      const r = await find(s.admin.cookie, w, '&limit=20');
      const found = allIds(r);
      for (const key of Object.keys(ids).filter((k) => k !== 'finance')) {
        expect(found).toContain(ids[key]);
      }
      expect(r.people?.map((h) => h.id).sort()).toEqual(
        [s.clientA.id, s.clientB.id, s.requester.id].sort(),
      );
      const jana = r.people?.find((h) => h.id === s.clientA.id);
      expect(jana).toMatchObject({ groupId: ids.groupA, role: 'client' });
      // Finance is out of the global search, for a finance admin as well.
      for (const who of [s.admin, s.finance, s.clientA]) {
        expect(allIds(await find(who.cookie, `zmluva ${w}`, '&limit=20'))).not.toContain(
          ids.finance,
        );
      }
    });

    it('ignores diacritics and case', async () => {
      const r = await find(s.clientA.cookie, `LUKY ${w}`);
      expect(r.groups?.map((h) => h.id)).toEqual([ids.groupA]);
      expect((await find(s.clientA.cookie, `uloha ${w}`)).tasks?.map((h) => h.id)).toEqual([
        ids.taskA,
      ]);
    });

    it('answers only the asked types', async () => {
      const r = await find(s.admin.cookie, w, '&types=tickets,groups');
      expect(Object.keys(r).sort()).toEqual(['groups', 'tickets']);
    });

    it('takes at most six queries, for an admin and for a client', async () => {
      const counting = createCountingDb();
      try {
        const query = {
          q: w,
          types: ['groups', 'tickets', 'tasks', 'knowledge', 'projects', 'people'] as const,
          limit: 5,
        };
        const asAdmin: SessionUser = {
          id: s.admin.id,
          email: s.admin.email,
          name: 'A',
          role: 'admin',
          finance: false,
        };
        // A warm-up first: each new pooled connection reads the array types once (postgres-js).
        await search(counting.db, asAdmin, { ...query, types: [...query.types] });
        counting.reset();
        await search(counting.db, asAdmin, { ...query, types: [...query.types] });
        expect(counting.count()).toBeLessThanOrEqual(6);
        counting.reset();
        const asClient: SessionUser = {
          id: s.clientA.id,
          email: s.clientA.email,
          name: 'J',
          role: 'client',
          finance: false,
        };
        await search(counting.db, asClient, { ...query, types: [...query.types] });
        expect(counting.count()).toBeLessThanOrEqual(6);
      } finally {
        await counting.close();
      }
    });
  });

  describe('a deactivated group', () => {
    const w = word();
    let ids: Record<string, string>;
    let client: Awaited<ReturnType<typeof person>>;
    let adm: Awaited<ReturnType<typeof admin>>;

    beforeAll(async () => {
      const g = await createGroup(db(), {
        name: `Obec ${w} Zavretá`,
        egrantUrl: `https://${host()}.egrant.sk`,
      });
      adm = await admin();
      client = await person(`Ida ${w}`, g.id, 'client');
      // Seeded before the deactivation: the database refuses new rows in it afterwards.
      const project = await createProject(db(), adm.id, g.id, {
        name: `Projekt ${w} Z`,
        description: '',
        fileIds: [],
      });
      const event = await createEvent(db(), adm.id, project.id, {
        name: `Kontrola ${w} Z`,
        occursOn: '2026-11-02',
        description: '',
        fileIds: [],
      });
      ids = {
        group: g.id,
        task: await task(adm.cookie, g.id, `Úloha ${w} Z`),
        ticket: (await ticket(g.id, `Chyba ${w} Z`, null)).id,
        note: await note(g.id, `Poznámka ${w} Z`, adm.id),
        project: project.id,
        event: event.id,
      };
      await setGroupDeactivated(db(), g.id, true);
    });

    it('its clients find nothing of it', async () => {
      expect(allIds(await find(client.cookie, w))).toEqual([]);
    });

    it('admins find nothing of it either (owner decision): no group, ticket, task, knowledge or project', async () => {
      const r = await find(adm.cookie, w);
      // People are accounts, not the group's content: its client is still found, but never
      // linked into the deactivated group.
      expect(r.people?.map((h) => [h.id, h.groupId])).toEqual([[client.id, null]]);
      expect(allIds({ ...r, people: [] })).toEqual([]);
      // ... and the same once it is active again: the seed itself is findable.
      await setGroupDeactivated(db(), ids.group!, false);
      try {
        const again = await find(adm.cookie, w);
        expect(allIds({ ...again, people: [] }).sort()).toEqual(Object.values(ids).sort());
        expect(again.people?.map((h) => h.groupId)).toEqual([ids.group]);
      } finally {
        await setGroupDeactivated(db(), ids.group!, true);
      }
    });

    it('the MCP search tool finds nothing of it for an admin', async () => {
      const token = await mcpToken(db(), adm.id);
      const res = await callTool(test.app, token, 'search', {
        q: w,
        types: 'groups,tickets,tasks,knowledge,projects',
      });
      expect(res.isError).toBe(false);
      expect(allIds(res.json as SearchResults)).toEqual([]);
    });
  });

  describe('ranking', () => {
    it('puts the whole name first, then a name starting with the query, then a word', async () => {
      const w = word();
      const g = async (name: string) =>
        (await createGroup(db(), { name, egrantUrl: `https://${host()}.egrant.sk` })).id;
      const inside = await g(`Klient x${w}y`);
      const word2 = await g(`Klient ${w} dva`);
      const starts = await g(`${w} Klient`);
      const exact = await g(w.toUpperCase());
      const a = await admin();
      const r = await find(a.cookie, w, '&types=groups');
      expect(r.groups?.map((h) => h.id)).toEqual([exact, starts, word2, inside]);
    });

    it('a ticket number finds that ticket first', async () => {
      const w = word();
      const a = await admin();
      const g = await createGroup(db(), {
        name: `Firma ${w}`,
        egrantUrl: `https://${host()}.egrant.sk`,
      });
      const t = await ticket(g.id, `Predmet ${w}`, null);
      const r = await find(a.cookie, `#${t.number}`, '&types=tickets');
      expect(r.tickets?.[0]).toMatchObject({
        id: t.id,
        number: t.number,
        groupId: g.id,
        groupName: `Firma ${w}`,
      });
    });

    it('lists open tasks before done ones with the same rank', async () => {
      const w = word();
      const a = await admin();
      const g = await createGroup(db(), {
        name: `Firma ${w}`,
        egrantUrl: `https://${host()}.egrant.sk`,
      });
      const open = await task(a.cookie, g.id, `Otvorená ${w}`);
      const done = await task(a.cookie, g.id, `Hotová ${w}`);
      // Both titles rank 2 (a word starts with the query); the done one is the newer.
      await db().update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, done));
      const r = await find(a.cookie, w, '&types=tasks');
      expect(r.tasks?.map((h) => [h.id, h.done])).toEqual([
        [open, false],
        [done, true],
      ]);
    });
  });

  describe('the route', () => {
    it('needs a session, 2 to 100 characters and known types', async () => {
      expect((await get('/api/search?q=abc')).statusCode).toBe(401);
      const a = await admin();
      expect((await get('/api/search?q=a', a.cookie)).statusCode).toBe(400);
      expect((await get(`/api/search?q=${'x'.repeat(101)}`, a.cookie)).statusCode).toBe(400);
      expect((await get('/api/search?q=abc&types=finance', a.cookie)).statusCode).toBe(400);
      expect((await get('/api/search?q=abc&limit=21', a.cookie)).statusCode).toBe(400);
    });

    it('caps each list at the limit', async () => {
      const w = word();
      const a = await admin();
      for (let i = 0; i < 4; i++) {
        await createGroup(db(), {
          name: `Klient ${w} ${i}`,
          egrantUrl: `https://${host()}.egrant.sk`,
        });
      }
      const r = await find(a.cookie, w, '&types=groups&limit=3');
      expect(r.groups).toHaveLength(3);
    });

    it('the 121st search in a minute is 429', async () => {
      const a = await admin();
      for (let i = 0; i < 120; i++) {
        expect((await get('/api/search?q=zz&types=groups', a.cookie)).statusCode).toBe(200);
      }
      const res = await get('/api/search?q=zz&types=groups', a.cookie);
      expect(res.statusCode).toBe(429);
      expect(res.json()).toEqual({ error: 'rate_limited' });
    });
  });
});
