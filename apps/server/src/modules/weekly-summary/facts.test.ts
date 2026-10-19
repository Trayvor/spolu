import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { insertTask } from '../../../test/tasks.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { projectEvents, projects } from '../projects/schema.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { collectFacts, hasActivity, type Facts } from './facts.js';
import { factsDraft } from './facts-draft.js';
import { addDays, bratislavaDay } from './week.js';
import { makeAdmin, makeGroup } from './test-fixtures.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('weekly summary facts', () => {
  it('collectFacts gives stable keys and refs', async () => {
    const g = await makeGroup(db);
    const a = await makeAdmin(db);
    const now = new Date();
    const today = bratislavaDay(now);
    const taskId = await insertTask(db, { groupId: g.id, createdBy: a.id, title: 'Rozpočet' });
    await db
      .update(tasks)
      .set({ completedAt: new Date(now.getTime() - DAY) })
      .where(eq(tasks.id, taskId));
    const ticketId = randomUUID();
    const [ticket] = await db
      .insert(tickets)
      .values({
        id: ticketId,
        groupId: g.id,
        source: 'manual',
        subject: 'Platba',
        status: 'resolved',
        resolvedAt: new Date(now.getTime() - DAY),
        createdAt: now,
        updatedAt: now,
      })
      .returning({ number: tickets.number });
    const projectId = randomUUID();
    await db
      .insert(projects)
      .values({ id: projectId, groupId: g.id, name: 'Dotácia', nameKey: projectId });
    const eventId = randomUUID();
    await db.insert(projectEvents).values({
      id: eventId,
      projectId,
      groupId: g.id,
      name: 'Podanie',
      nameKey: eventId,
      occursOn: addDays(today, 3),
    });
    const facts = await collectFacts(
      db,
      g.id,
      { start: new Date(now.getTime() - 7 * DAY), end: new Date(now.getTime() + 1000) },
      today,
    );
    expect(facts.done.map((f) => [f.key, f.ref, f.text])).toEqual([
      ['t1', { kind: 'task', id: taskId }, 'Rozpočet'],
      ['k1', { kind: 'ticket', id: ticketId }, `#${ticket!.number} Platba`],
    ]);
    expect(facts.upcoming.map((f) => [f.key, f.ref, f.text, f.date])).toEqual([
      ['e1', { kind: 'event', id: eventId }, 'Podanie (Dotácia)', addDays(today, 3)],
    ]);
    expect(hasActivity(facts)).toBe(true);
  });

  it('hasActivity is false with no facts and no messages', () => {
    expect(hasActivity({ done: [], waiting: [], upcoming: [], messages: [] })).toBe(false);
  });

  it('factsDraft writes the fixed intro and closing in the draft language', () => {
    const facts: Facts = {
      done: [{ key: 't1', ref: { kind: 'task', id: 'x' }, text: 'Rozpočet', date: '2026-10-15' }],
      waiting: [{ key: 't2', ref: { kind: 'task', id: 'y' }, text: 'Podpis', date: '2026-10-20' }],
      upcoming: [],
      messages: [],
    };
    const range = '13. 10. – 17. 10. 2026';
    const draft = factsDraft(facts, 'sk', range);
    expect(draft.intro).toBe(serverTexts('sk').weeklySummary.factsIntro(range));
    expect(draft.closing).toBe(serverTexts('sk').weeklySummary.factsClosing);
    expect(draft.done.map((i) => [i.text, i.ref])).toEqual([
      ['Rozpočet', { kind: 'task', id: 'x' }],
    ]);
    expect(draft.waiting[0]!.text).toBe('Podpis – 20. 10. 2026');
    for (const item of [...draft.done, ...draft.waiting]) expect(item.id).toMatch(UUID);
    expect(factsDraft(facts, 'it', range).intro).toBe(
      serverTexts('it').weeklySummary.factsIntro(range),
    );
  });
});
