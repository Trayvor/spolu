import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
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
  inDays,
} from '../../../test/calendar.js';
import { activeGroupLabels, setGroupDeactivated } from '../groups/service.js';
import { feedCalls } from '../knowledge/feed.js';
import { feedEvents } from '../projects/feed.js';
import { feedAssignedDeadlines } from '../tasks/feed.js';
import { meetingDurations } from '../teams/service.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

describe('calendar feed sources (ADR 0051)', () => {
  let g1: string;
  let g2: string;
  let adminId: string;
  beforeAll(async () => {
    g1 = (await feedGroup(db, 'Feed One')).id;
    g2 = (await feedGroup(db, 'Feed Two')).id;
    adminId = (await feedAdmin(db)).id;
  });

  it('activeGroupLabels leaves deactivated groups out', async () => {
    const a = (await feedGroup(db, 'Live')).id;
    const b = (await feedGroup(db, 'Gone')).id;
    await setGroupDeactivated(db, b, true);
    const some = await activeGroupLabels(db, [a, b]);
    expect([...some.entries()]).toEqual([[a, 'Live']]);
    const all = await activeGroupLabels(db, 'all');
    expect(all.get(a)).toBe('Live');
    expect(all.has(b)).toBe(false);
    expect((await activeGroupLabels(db, [])).size).toBe(0);
  });

  it('feedEvents: only the given groups, the window, active projects', async () => {
    const p = await feedProject(db, g1);
    const archived = await feedProject(db, g1, { status: 'archived' });
    const other = await feedProject(db, g2);
    const from = dayFromNow(-10);
    const to = dayFromNow(10);
    const before = await feedEvent(db, { projectId: p, groupId: g1, occursOn: dayFromNow(-11) });
    const first = await feedEvent(db, { projectId: p, groupId: g1, occursOn: from });
    const last = await feedEvent(db, { projectId: p, groupId: g1, occursOn: to });
    const after = await feedEvent(db, { projectId: p, groupId: g1, occursOn: dayFromNow(11) });
    const ofArchived = await feedEvent(db, { projectId: archived, groupId: g1, occursOn: from });
    const ofOther = await feedEvent(db, { projectId: other, groupId: g2, occursOn: from });
    const rows = await feedEvents(db, { groupIds: [g1], from, to });
    const ids = rows.map((r) => r.id);
    expect(ids).toEqual([first, last]);
    for (const id of [before, after, ofArchived, ofOther]) expect(ids).not.toContain(id);
    expect(rows[0]).toMatchObject({
      groupId: g1,
      projectName: 'Projekt Lúky 2026',
      name: 'Odovzdanie žiadosti',
      occursOn: from,
    });
    expect(rows[0]!.updatedAt).toBeInstanceOf(Date);
    expect(await feedEvents(db, { groupIds: [], from, to })).toEqual([]);
  });

  it('feedAssignedDeadlines: assigned, open, dated tasks of the given groups', async () => {
    const me = (await feedClient(db, [g1, g2])).id;
    const someone = (await feedClient(db, [g1])).id;
    const due = dayFromNow(3);
    const mine = await insertTask(db, {
      groupId: g1,
      createdBy: adminId,
      dueDate: due,
      assignees: [me],
    });
    const done = await insertTask(db, {
      groupId: g1,
      createdBy: adminId,
      dueDate: due,
      assignees: [me],
      done: true,
    });
    const undated = await insertTask(db, { groupId: g1, createdBy: adminId, assignees: [me] });
    const theirs = await insertTask(db, {
      groupId: g1,
      createdBy: adminId,
      dueDate: due,
      assignees: [someone],
    });
    const otherGroup = await insertTask(db, {
      groupId: g2,
      createdBy: adminId,
      dueDate: due,
      assignees: [me],
    });
    const rows = await feedAssignedDeadlines(db, {
      userId: me,
      groupIds: [g1],
      from: dayFromNow(-30),
      to: dayFromNow(30),
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(mine);
    for (const id of [done, undated, theirs, otherGroup]) expect(ids).not.toContain(id);
    expect(rows.find((r) => r.id === mine)).toMatchObject({ groupId: g1, dueDate: due });
  });

  it('feedCalls: admins-only calls only with includeAdminsOnly', async () => {
    const g = (await feedGroup(db, 'Calls')).id;
    const start = inDays(2);
    const open = await feedCall(db, { groupId: g, createdBy: adminId, startsAt: start });
    const closed = await feedCall(db, {
      groupId: g,
      createdBy: adminId,
      startsAt: new Date(start.getTime() + 60_000),
      visibility: 'admins',
    });
    const q = { groupIds: [g], from: inDays(0), to: inDays(30) };
    expect((await feedCalls(db, { ...q, includeAdminsOnly: false })).map((r) => r.id)).toEqual([
      open,
    ]);
    const both = await feedCalls(db, { ...q, includeAdminsOnly: true });
    expect(both.map((r) => r.id)).toEqual([open, closed]);
    expect(both[0]!.startsAt.getTime()).toBe(start.getTime());
  });

  it('feedCalls: the window is [from, to)', async () => {
    const g = (await feedGroup(db, 'Window')).id;
    const from = inDays(1);
    const to = inDays(5);
    const atFrom = await feedCall(db, { groupId: g, createdBy: adminId, startsAt: from });
    await feedCall(db, { groupId: g, createdBy: adminId, startsAt: to });
    await feedCall(db, {
      groupId: g,
      createdBy: adminId,
      startsAt: new Date(from.getTime() - 60_000),
    });
    const rows = await feedCalls(db, { groupIds: [g], includeAdminsOnly: true, from, to });
    expect(rows.map((r) => r.id)).toEqual([atFrom]);
  });

  it('caps each source at its limit in date order', async () => {
    const g = (await feedGroup(db, 'Cap')).id;
    const p = await feedProject(db, g);
    const ids: string[] = [];
    for (const n of [5, 1, 4, 2, 3]) {
      ids[n] = await feedEvent(db, { projectId: p, groupId: g, occursOn: dayFromNow(n) });
    }
    const rows = await feedEvents(db, {
      groupIds: [g],
      from: dayFromNow(0),
      to: dayFromNow(10),
      limit: 3,
    });
    expect(rows.map((r) => r.id)).toEqual([ids[1], ids[2], ids[3]]);
  });

  it('meetingDurations returns the Teams length by item id', async () => {
    const g = (await feedGroup(db, 'Teams')).id;
    const start = inDays(1);
    const withTeams = await feedCall(db, { groupId: g, createdBy: adminId, startsAt: start });
    const without = await feedCall(db, { groupId: g, createdBy: adminId, startsAt: start });
    await feedTeamsLink(db, withTeams, start, 45);
    const map = await meetingDurations(db, [withTeams, without]);
    expect([...map.entries()]).toEqual([[withTeams, 45]]);
    expect((await meetingDurations(db, [])).size).toBe(0);
  });
});
