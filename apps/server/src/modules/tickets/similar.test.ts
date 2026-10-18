import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { createDb } from '../../infra/db/client.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { createGroup } from '../groups/service.js';
import { tickets } from './schema.js';
import { similarResolvedTickets } from './similar.js';

const { db, close } = createDb(testDatabaseUrl);
const counting = createCountingDb();
afterAll(() => Promise.all([close(), counting.close()]));

const word = () =>
  `zq${Array.from({ length: 6 }, () => String.fromCharCode(97 + Math.floor(Math.random() * 26))).join('')}`;
const newGroup = (name = 'Firma') =>
  createGroup(db, { name, egrantUrl: `https://s${randomUUID().replaceAll('-', '')}.egrant.sk` });

async function ticket(over: Partial<typeof tickets.$inferInsert>): Promise<string> {
  const id = randomUUID();
  const now = new Date();
  await db.insert(tickets).values({
    id,
    groupId: null,
    status: 'resolved',
    source: 'manual',
    createdAt: now,
    updatedAt: now,
    resolvedAt: now,
    ...over,
  });
  return id;
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

describe('similarResolvedTickets', () => {
  it('finds resolved tickets of every client, never the ticket itself', async () => {
    const [a, b] = [await newGroup(), await newGroup('Obec Lúky')];
    const w = word();
    const self = await ticket({ groupId: a.id, subject: `Rozpočet ${w}`, status: 'new' });
    await ticket({ groupId: a.id, subject: `Nový ${w}`, status: 'new' });
    await ticket({ groupId: a.id, subject: `Rieši sa ${w}`, status: 'in_progress' });
    const other = await ticket({
      groupId: b.id,
      subject: `Zmena ${w}`,
      body: 'Dobrý deň',
      requesterName: 'Ján Novák',
      requesterEmail: 'jan@luky.sk',
      requesterPhone: '+421 900 000 000',
    });
    const rows = await similarResolvedTickets(db, {
      ticketId: self,
      groupId: a.id,
      terms: [w],
      limit: 3,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        id: other,
        subject: `Zmena ${w}`,
        bodyHead: 'Dobrý deň',
        groupId: b.id,
        groupName: 'Obec Lúky',
        requesterName: 'Ján Novák',
        requesterEmail: 'jan@luky.sk',
        requesterPhone: '+421 900 000 000',
      }),
    ]);
  });

  it("puts the ticket's own client first on an equal score", async () => {
    const [a, b] = [await newGroup(), await newGroup()];
    const w = word();
    const later = new Date(Date.now() + 60_000);
    const otherClient = await ticket({ groupId: b.id, subject: w, resolvedAt: later });
    const own = await ticket({ groupId: a.id, subject: w });
    const rows = await similarResolvedTickets(db, {
      ticketId: randomUUID(),
      groupId: a.id,
      terms: [w],
      limit: 3,
    });
    expect(ids(rows)).toEqual([own, otherClient]);
  });

  it('works for a ticket without a client', async () => {
    const b = await newGroup();
    const w = word();
    const found = await ticket({ groupId: b.id, subject: w });
    const rows = await similarResolvedTickets(db, {
      ticketId: randomUUID(),
      groupId: null,
      terms: [w],
      limit: 3,
    });
    expect(ids(rows)).toEqual([found]);
  });

  it('ranks subject matches over body matches, then the latest resolved, and keeps the limit', async () => {
    const w = word();
    const old = new Date(Date.now() - 3_600_000);
    const bodyOnly = await ticket({ subject: 'Iné', body: `Text o rozpočte ${w}` });
    const subjectOld = await ticket({ subject: `Predmet ${w}`, resolvedAt: old });
    const subjectNew = await ticket({ subject: `Predmet ${w}` });
    await ticket({ subject: 'Iné', body: `Ďalší ${w}`, resolvedAt: old });
    const rows = await similarResolvedTickets(db, {
      ticketId: randomUUID(),
      groupId: null,
      terms: [w],
      limit: 3,
    });
    expect(ids(rows)).toEqual([subjectNew, subjectOld, bodyOnly]);
  });

  it('matches folded terms against accented text', async () => {
    const w = word();
    const id = await ticket({ subject: `Zmena rozpočtu ${w}`, body: `Žiadosť o platbu ${w}` });
    const rows = await similarResolvedTickets(db, {
      ticketId: randomUUID(),
      groupId: null,
      terms: [w, 'ziados', 'rozpoc'],
      limit: 50,
    });
    expect(ids(rows)[0]).toBe(id);
  });

  it('runs no query without terms', async () => {
    await counting.db.execute(sql`select 1`); // the client's first query reads its types
    counting.reset();
    expect(
      await similarResolvedTickets(counting.db, {
        ticketId: 'x',
        groupId: null,
        terms: [],
        limit: 3,
      }),
    ).toEqual([]);
    expect(counting.count()).toBe(0);
  });
});
