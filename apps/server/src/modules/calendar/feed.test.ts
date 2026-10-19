import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { KnowledgeItemDtoSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createDb } from '../../infra/db/client.js';
import { insertTask } from '../../../test/tasks.js';
import {
  dayFromNow,
  feedAdmin,
  feedCall,
  feedClient,
  feedEvent,
  feedGroup,
  feedProject,
  feedTeamsLink,
  icsLines,
  inDays,
  uidsOf,
  type FeedPerson,
} from '../../../test/calendar.js';
import { removeMembership } from '../groups/memberships.js';
import { knowledgeMeetings } from '../knowledge/schema.js';
import { projectEvents } from '../projects/schema.js';
import { buildFeedFor } from './feed.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const ALL = { events: true, tasks: true, calls: true };
const URL_BASE = 'https://help.example';

describe('buildFeedFor (ADR 0051)', () => {
  let test: TestApp;
  const db = () => test.deps.db;
  const feed = (person: FeedPerson, include = ALL) => buildFeedFor(db(), person, include, URL_BASE);

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it("a client gets their groups' events, own deadlines and public calls only", async () => {
    const g = (await feedGroup(db())).id;
    const other = (await feedGroup(db(), 'Iná firma')).id;
    const admin = await feedAdmin(db());
    const client = await feedClient(db(), [g]);
    const someone = await feedClient(db(), [g], 'Peter');
    const p = await feedProject(db(), g);
    const op = await feedProject(db(), other);
    const e1 = await feedEvent(db(), { projectId: p, groupId: g, occursOn: dayFromNow(5) });
    const e2 = await feedEvent(db(), { projectId: op, groupId: other, occursOn: dayFromNow(5) });
    const t1 = await insertTask(db(), {
      groupId: g,
      createdBy: admin.id,
      dueDate: dayFromNow(4),
      assignees: [client.id],
    });
    const t2 = await insertTask(db(), {
      groupId: g,
      createdBy: admin.id,
      dueDate: dayFromNow(4),
      assignees: [someone.id],
    });
    const c1 = await feedCall(db(), { groupId: g, createdBy: admin.id, startsAt: inDays(3) });
    const c2 = await feedCall(db(), {
      groupId: g,
      createdBy: admin.id,
      startsAt: inDays(3),
      visibility: 'admins',
    });
    const uids = uidsOf((await feed(client)).text);
    expect(uids).toEqual(
      expect.arrayContaining([
        `event-${e1}@spolu`,
        `task-${t1}-deadline@spolu`,
        `call-${c1}@spolu`,
      ]),
    );
    for (const absent of [`event-${e2}@spolu`, `task-${t2}-deadline@spolu`, `call-${c2}@spolu`]) {
      expect(uids).not.toContain(absent);
    }
  });

  it("an admin gets only their assigned deadlines and their own clients' events and calls", async () => {
    const g1 = (await feedGroup(db(), 'Klient A')).id;
    const g2 = (await feedGroup(db(), 'Klient B')).id;
    const a = await feedAdmin(db(), 'Admin A', [g1]);
    const b = await feedAdmin(db(), 'Admin B', [g2]);
    const p1 = await feedProject(db(), g1);
    const p2 = await feedProject(db(), g2);
    const e1 = await feedEvent(db(), { projectId: p1, groupId: g1, occursOn: dayFromNow(2) });
    const e2 = await feedEvent(db(), { projectId: p2, groupId: g2, occursOn: dayFromNow(2) });
    const c1 = await feedCall(db(), {
      groupId: g1,
      createdBy: a.id,
      startsAt: inDays(2),
      visibility: 'admins',
    });
    const c2 = await feedCall(db(), { groupId: g2, createdBy: b.id, startsAt: inDays(2) });
    const mineInG2 = await insertTask(db(), {
      groupId: g2,
      createdBy: b.id,
      dueDate: dayFromNow(6),
      assignees: [a.id],
    });
    const unassignedInG1 = await insertTask(db(), {
      groupId: g1,
      createdBy: a.id,
      dueDate: dayFromNow(6),
    });
    const uids = uidsOf((await feed(a)).text);
    expect(uids).toEqual(
      expect.arrayContaining([
        `event-${e1}@spolu`,
        `call-${c1}@spolu`,
        `task-${mineInG2}-deadline@spolu`,
      ]),
    );
    for (const absent of [
      `event-${e2}@spolu`,
      `call-${c2}@spolu`,
      `task-${unassignedInG1}-deadline@spolu`,
    ]) {
      expect(uids).not.toContain(absent);
    }
  });

  it('an admin who manages no client gets only their assigned deadlines', async () => {
    const g = (await feedGroup(db())).id;
    const admin = await feedAdmin(db(), 'Nobody');
    const p = await feedProject(db(), g);
    await feedEvent(db(), { projectId: p, groupId: g, occursOn: dayFromNow(1) });
    await feedCall(db(), { groupId: g, createdBy: admin.id, startsAt: inDays(1) });
    const t = await insertTask(db(), {
      groupId: g,
      createdBy: admin.id,
      dueDate: dayFromNow(1),
      assignees: [admin.id],
    });
    expect(uidsOf((await feed(admin)).text)).toEqual([`task-${t}-deadline@spolu`]);
  });

  it('excludes every kind switched off', async () => {
    const g = (await feedGroup(db())).id;
    const admin = await feedAdmin(db());
    const client = await feedClient(db(), [g]);
    const p = await feedProject(db(), g);
    await feedEvent(db(), { projectId: p, groupId: g, occursOn: dayFromNow(1) });
    await feedCall(db(), { groupId: g, createdBy: admin.id, startsAt: inDays(1) });
    await insertTask(db(), {
      groupId: g,
      createdBy: admin.id,
      dueDate: dayFromNow(1),
      assignees: [client.id],
    });
    const { text } = await feed(client, { events: false, tasks: false, calls: false });
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).not.toContain('BEGIN:VEVENT');
    const onlyCalls = uidsOf(
      (await feed(client, { events: false, tasks: false, calls: true })).text,
    );
    expect(onlyCalls).toHaveLength(1);
    expect(onlyCalls[0]).toMatch(/^call-/);
  });

  it('prefixes the client name only for admins', async () => {
    const g = (await feedGroup(db(), 'Obec Lúky')).id;
    const admin = await feedAdmin(db(), 'Prefix Admin', [g]);
    const client = await feedClient(db(), [g]);
    await feedCall(db(), { groupId: g, createdBy: admin.id, startsAt: inDays(1) });
    expect(icsLines((await feed(admin)).text)).toContain('SUMMARY:Obec Lúky: Hovor: Porada');
    expect(icsLines((await feed(client)).text)).toContain('SUMMARY:Hovor: Porada');
  });

  it('a call without Teams lasts 60 minutes, with Teams its length; LOCATION is its link', async () => {
    const g = (await feedGroup(db())).id;
    const admin = await feedAdmin(db(), 'Teams Admin', [g]);
    const start = new Date('2026-12-01T09:00:00Z');
    const now = new Date('2026-11-20T12:00:00Z');
    const plain = await feedCall(db(), {
      groupId: g,
      createdBy: admin.id,
      startsAt: start,
      meetingUrl: 'https://zoom.example.com/j/1',
    });
    const teams = await feedCall(db(), { groupId: g, createdBy: admin.id, startsAt: start });
    await feedTeamsLink(db(), teams, start, 30);
    const lines = icsLines((await buildFeedFor(db(), admin, ALL, URL_BASE, now)).text);
    const block = (id: string) => {
      const at = lines.indexOf(`UID:call-${id}@spolu`);
      return lines.slice(at, lines.indexOf('END:VEVENT', at));
    };
    expect(block(plain)).toContain('DTSTART:20261201T090000Z');
    expect(block(plain)).toContain('DTEND:20261201T100000Z');
    expect(block(plain)).toContain('LOCATION:https://zoom.example.com/j/1');
    expect(block(teams)).toContain('DTEND:20261201T093000Z');
  });

  it('a call carries no notes or transcript', async () => {
    const g = (await feedGroup(db())).id;
    const admin = await feedAdmin(db(), 'Secret Admin', [g]);
    await feedCall(db(), {
      groupId: g,
      createdBy: admin.id,
      startsAt: inDays(1),
      body: 'tajné poznámky',
      transcript: 'tajný prepis',
    });
    const { text } = await feed(admin);
    expect(text).toContain('BEGIN:VEVENT');
    expect(text).not.toContain('tajn');
  });

  it('times are UTC and dates all-day; descriptions carry the link and are cut', async () => {
    const g = (await feedGroup(db())).id;
    const admin = await feedAdmin(db(), 'Dates Admin', [g]);
    const p = await feedProject(db(), g);
    const now = new Date('2026-10-20T08:00:00Z');
    const e = await feedEvent(db(), {
      projectId: p,
      groupId: g,
      occursOn: '2026-11-01',
      description: 'x'.repeat(1200),
    });
    await feedCall(db(), {
      groupId: g,
      createdBy: admin.id,
      startsAt: new Date('2026-10-25T09:00:00Z'),
    });
    const lines = icsLines((await buildFeedFor(db(), admin, ALL, URL_BASE, now)).text);
    expect(lines).toContain('DTSTART:20261025T090000Z');
    expect(lines).toContain('DTSTART;VALUE=DATE:20261101');
    const description = lines.find((l) => l.startsWith('DESCRIPTION:x'))!;
    expect(description).toBe(
      `DESCRIPTION:${'x'.repeat(1000)}\\n\\n${URL_BASE}/groups/${g}/overview?event=${e}`,
    );
  });

  it('renders mentions as names of the group, and @? for anyone else', async () => {
    const g = (await feedGroup(db())).id;
    const client = await feedClient(db(), [g], 'Jana Členka');
    const outsider = await feedClient(db(), [(await feedGroup(db(), 'Cudzia')).id], 'Cudzí');
    const p = await feedProject(db(), g);
    await feedEvent(db(), {
      projectId: p,
      groupId: g,
      occursOn: dayFromNow(2),
      description: `Pre <@${client.id}> a <@${outsider.id}>`,
    });
    const lines = icsLines((await feed(client)).text);
    expect(lines.find((l) => l.startsWith('DESCRIPTION:Pre'))).toMatch(
      /^DESCRIPTION:Pre @Jana Členka a @\?\\n/,
    );
  });

  it('the same data gives the same ETag; an edit or a delete changes it', async () => {
    const g = (await feedGroup(db())).id;
    const client = await feedClient(db(), [g]);
    const p = await feedProject(db(), g);
    const e = await feedEvent(db(), { projectId: p, groupId: g, occursOn: dayFromNow(3) });
    const first = await feed(client);
    expect((await feed(client)).etag).toBe(first.etag);
    expect(first.etag).toMatch(/^"[A-Za-z0-9_-]{22}"$/);
    await db()
      .update(projectEvents)
      .set({ name: 'Nový názov', updatedAt: new Date() })
      .where(eq(projectEvents.id, e));
    const edited = await feed(client);
    expect(edited.etag).not.toBe(first.etag);
    await db().delete(projectEvents).where(eq(projectEvents.id, e));
    const deleted = await feed(client);
    expect(deleted.etag).not.toBe(edited.etag);
    expect(deleted.text).not.toContain('BEGIN:VEVENT');
  });

  it('a client with no client group left gets an empty calendar', async () => {
    const g = (await feedGroup(db())).id;
    const client = await feedClient(db(), [g]);
    const p = await feedProject(db(), g);
    await feedEvent(db(), { projectId: p, groupId: g, occursOn: dayFromNow(3) });
    expect((await feed(client)).text).toContain('BEGIN:VEVENT');
    await removeMembership(db(), g, client.id);
    const { text } = await feed(client);
    expect(text).toContain('BEGIN:VCALENDAR');
    expect(text).not.toContain('BEGIN:VEVENT');
  });

  it("texts follow the user's language", async () => {
    const g = (await feedGroup(db())).id;
    const admin = await feedAdmin(db());
    const client = await feedClient(db(), [g], 'Mary');
    await feedCall(db(), { groupId: g, createdBy: admin.id, startsAt: inDays(1) });
    const lines = icsLines((await feed({ ...client, language: 'en' })).text);
    expect(lines).toContain('X-WR-CALNAME:Help – Mary');
    expect(lines).toContain('SUMMARY:Call: Porada');
  });

  it('includes every created call of a recurring series as its own event', async () => {
    const g = (await feedGroup(db())).id;
    const admin = await feedAdmin(db(), 'Series Admin', [g]);
    const cookie = await loginAs(test.app, admin.email);
    const start = inDays(1);
    const res = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${g}/knowledge`,
      headers: { cookie },
      payload: {
        type: 'meeting',
        title: 'Týždenná porada',
        body: '',
        meeting: {
          startsAt: start.toISOString(),
          meetingUrl: null,
          repeat: { timeZone: 'Europe/Bratislava', frequency: 'weekly', count: 3 },
        },
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const seriesId = KnowledgeItemDtoSchema.parse(res.json()).meetingDetail!.series!.id;
    const calls = await db()
      .select({ id: knowledgeMeetings.itemId })
      .from(knowledgeMeetings)
      .where(eq(knowledgeMeetings.seriesId, seriesId));
    expect(calls).toHaveLength(3);
    const uids = uidsOf((await feed(admin)).text);
    for (const c of calls) expect(uids).toContain(`call-${c.id}@spolu`);
  });

  it('costs a fixed number of statements whatever the size', async () => {
    // The driver's own array type lookups on a new connection (pg_catalog) are not ours.
    let queries = 0;
    const counting = createDb(testDatabaseUrl, {
      onQuery: (q) => void (q.includes('pg_catalog') ? 0 : queries++),
    });
    try {
      const g = (await feedGroup(counting.db)).id;
      const admin = await feedAdmin(counting.db, 'Count Admin', [g]);
      const p = await feedProject(counting.db, g);
      const seed = async (n: number) => {
        for (let i = 0; i < n; i++) {
          await feedEvent(counting.db, { projectId: p, groupId: g, occursOn: dayFromNow(i % 20) });
          await feedCall(counting.db, { groupId: g, createdBy: admin.id, startsAt: inDays(1 + i) });
          await insertTask(counting.db, {
            groupId: g,
            createdBy: admin.id,
            dueDate: dayFromNow(i % 20),
            assignees: [admin.id],
            description: `pre <@${admin.id}>`,
          });
        }
      };
      const count = async () => {
        queries = 0;
        await buildFeedFor(counting.db, admin, ALL, URL_BASE);
        return queries;
      };
      await seed(10);
      const small = await count();
      await seed(90);
      const large = await count();
      // clientGroupIds or the group labels, the managed groups and the admin group's id, the
      // three sources, the Teams lengths and the mentioned names.
      expect(small).toBeLessThanOrEqual(8);
      expect(large).toBe(small);
    } finally {
      await counting.close();
    }
  });
});
