import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { makeGroup } from '../weekly-summary/test-fixtures.js';
import { tickets } from './schema.js';
import { resolvedTicketsOf, ticketRefsInGroup, ticketTitlesInGroup } from './weekly-facts.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const DAY = 86_400_000;

async function insertTicket(groupId: string | null, resolvedAt: Date | null, subject = 'Login') {
  const id = randomUUID();
  const at = new Date();
  const [row] = await db
    .insert(tickets)
    .values({
      id,
      groupId,
      source: 'manual',
      subject,
      status: resolvedAt ? 'resolved' : 'new',
      resolvedAt,
      createdAt: at,
      updatedAt: at,
    })
    .returning({ number: tickets.number });
  return { id, number: row!.number };
}

describe('tickets: weekly summary facts', () => {
  it('resolvedTicketsOf lists tickets resolved in the window of this group', async () => {
    const [g, other] = [await makeGroup(db), await makeGroup(db)];
    const to = new Date();
    const from = new Date(to.getTime() - 7 * DAY);
    const inside = await insertTicket(g.id, new Date(to.getTime() - DAY), 'Platba');
    await insertTicket(g.id, new Date(from.getTime() - DAY));
    await insertTicket(g.id, null);
    const moved = await insertTicket(g.id, new Date(to.getTime() - DAY));
    await db.update(tickets).set({ groupId: other.id }).where(eq(tickets.id, moved.id));
    await insertTicket(null, new Date(to.getTime() - DAY));
    const rows = await resolvedTicketsOf(db, g.id, from, to);
    expect(rows.map((r) => [r.id, r.number, r.subject])).toEqual([
      [inside.id, inside.number, 'Platba'],
    ]);
    expect((await resolvedTicketsOf(db, other.id, from, to)).map((r) => r.id)).toEqual([moved.id]);
  });

  it('ticketRefsInGroup keeps only tickets of the group, titled #number subject', async () => {
    const [g, other] = [await makeGroup(db), await makeGroup(db)];
    const mine = await insertTicket(g.id, null, 'Prihlásenie');
    const theirs = await insertTicket(other.id, null);
    expect([...(await ticketRefsInGroup(db, g.id, [mine.id, theirs.id]))]).toEqual([mine.id]);
    expect((await ticketTitlesInGroup(db, g.id, [mine.id])).get(mine.id)).toBe(
      `#${mine.number} Prihlásenie`,
    );
  });
});
