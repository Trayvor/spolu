import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { makeGroup } from '../weekly-summary/test-fixtures.js';
import { projectEvents, projects } from './schema.js';
import { eventRefsInGroup, eventTitlesInGroup, upcomingEventsOf } from './weekly-facts.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

async function project(groupId: string, name: string, status: 'active' | 'archived' = 'active') {
  const id = randomUUID();
  await db.insert(projects).values({ id, groupId, name, nameKey: `${name} ${id}`, status });
  return id;
}
async function event(groupId: string, projectId: string, name: string, occursOn: string) {
  const id = randomUUID();
  await db
    .insert(projectEvents)
    .values({ id, projectId, groupId, name, nameKey: `${name} ${id}`, occursOn });
  return id;
}

describe('projects: weekly summary facts', () => {
  it('upcomingEventsOf skips archived projects and events outside the range', async () => {
    const g = await makeGroup(db);
    const active = await project(g.id, 'Dotácia');
    const archived = await project(g.id, 'Stará', 'archived');
    const first = await event(g.id, active, 'Podanie', '2030-01-01');
    const last = await event(g.id, active, 'Vyúčtovanie', '2030-01-14');
    await event(g.id, active, 'Neskôr', '2030-01-15');
    await event(g.id, archived, 'Archív', '2030-01-05');
    const rows = await upcomingEventsOf(db, g.id, '2030-01-01', '2030-01-14');
    expect(rows).toEqual([
      { id: first, name: 'Podanie', projectName: 'Dotácia', occursOn: '2030-01-01' },
      { id: last, name: 'Vyúčtovanie', projectName: 'Dotácia', occursOn: '2030-01-14' },
    ]);
  });

  it('eventRefsInGroup drops deleted events and other groups', async () => {
    const [g, other] = [await makeGroup(db), await makeGroup(db)];
    const p = await project(g.id, 'Dotácia');
    const q = await project(other.id, 'Iná');
    const mine = await event(g.id, p, 'Podanie', '2030-01-01');
    const theirs = await event(other.id, q, 'Cudzia', '2030-01-01');
    const gone = await event(g.id, p, 'Zmazaná', '2030-01-01');
    await db.delete(projectEvents).where(eq(projectEvents.id, gone));
    expect([...(await eventRefsInGroup(db, g.id, [mine, theirs, gone]))]).toEqual([mine]);
    expect((await eventTitlesInGroup(db, g.id, [mine])).get(mine)).toEqual({
      title: 'Podanie (Dotácia)',
      projectId: p,
    });
  });
});
