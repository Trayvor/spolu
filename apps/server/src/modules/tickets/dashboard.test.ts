import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { HomeTickets, TicketStatus } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { newAdmin, newGroup } from '../home/test-fixtures.js';
import { countDashboardTickets, getDashboardTickets } from './dashboard.js';
import { ticketAssignees, tickets } from './schema.js';
import { setTicketWatch } from './watch.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

/** Inserts a ticket directly (no initiator or email). */
async function newTicket(input: {
  groupId: string | null;
  status?: TicketStatus;
  subject?: string | null;
  body?: string | null;
  createdAt?: Date;
}) {
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date();
  await db.insert(tickets).values({
    id,
    groupId: input.groupId,
    status: input.status ?? 'new',
    source: 'manual',
    subject: input.subject === undefined ? 'Ticket' : input.subject,
    body: input.body ?? null,
    createdAt,
    updatedAt: createdAt,
  });
  return id;
}

const at = (iso: string) => new Date(iso);

class Rollback<T> extends Error {
  constructor(readonly value: T) {
    super('rollback');
  }
}

// Other test files write tickets without a client into the same database at the same time, so
// those are checked by presence and lower bounds; the tickets of a fresh client are exact.

describe('getDashboardTickets', () => {
  it('lists the active tickets of my clients, New first, then newest first', async () => {
    const mineA = await newGroup(db, 'Mine A');
    const mineB = await newGroup(db, 'Mine B');
    const other = await newGroup(db, 'Not mine');
    const me = await newAdmin(db, 'Ada', [mineA.id, mineB.id]);
    const ticket = (groupId: string, status: TicketStatus, subject: string, created?: string) =>
      newTicket({ groupId, status, subject, createdAt: created ? at(created) : undefined });
    // Inserted out of order on purpose.
    await ticket(mineA.id, 'in_progress', 'progress newer', '2026-10-05T10:00:00Z');
    await ticket(mineB.id, 'new', 'new older', '2026-10-01T10:00:00Z');
    await ticket(mineA.id, 'in_progress', 'progress older', '2026-10-02T10:00:00Z');
    await ticket(mineA.id, 'new', 'new newer', '2026-10-03T10:00:00Z');
    await ticket(mineA.id, 'resolved', 'resolved');
    await ticket(other.id, 'new', 'other client');

    // Other files' tickets without a client would push these out of the 20 rows: read the card
    // in a transaction that hides them, and roll it back.
    const result = await db
      .transaction(async (tx) => {
        await tx
          .update(tickets)
          .set({ status: 'resolved' })
          .where(sql`${tickets.groupId} is null and ${tickets.status} <> 'resolved'`);
        throw new Rollback(await getDashboardTickets(tx, me.id));
      })
      .catch((error: unknown): HomeTickets => {
        if (error instanceof Rollback) return error.value as HomeTickets;
        throw error;
      });
    const mine = result.items.filter((t) => t.groupId === mineA.id || t.groupId === mineB.id);
    expect(mine.map((t) => t.subject)).toEqual([
      'new newer',
      'new older',
      'progress newer',
      'progress older',
    ]);
    expect(mine[0]).toMatchObject({ groupName: 'Mine A', status: 'new' });
    expect(result.items.some((t) => t.subject === 'other client')).toBe(false);
    expect(result.items.some((t) => t.status === 'resolved')).toBe(false);
  });

  it('includes the active tickets without a client, and counts them', async () => {
    const me = await newAdmin(db, 'Ada');
    const subject = `unassigned ${randomUUID()}`;
    const id = await newTicket({ groupId: null, status: 'new', subject });
    const resolved = await newTicket({ groupId: null, status: 'resolved' });
    const result = await getDashboardTickets(db, me.id);
    expect(result.items.find((t) => t.id === id)).toMatchObject({
      groupId: null,
      groupName: null,
      subject,
      status: 'new',
    });
    expect(result.items.some((t) => t.id === resolved)).toBe(false);
    expect(result.noAssignee).toBeGreaterThanOrEqual(1);
    expect(result.fresh).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeGreaterThanOrEqual(result.noAssignee);
  });

  it('gives an excerpt for a ticket without a subject', async () => {
    const g = await newGroup(db, 'Excerpt');
    const me = await newAdmin(db, 'Ada', [g.id]);
    await newTicket({ groupId: g.id, subject: null, body: 'x'.repeat(200) });
    const result = await getDashboardTickets(db, me.id);
    const row = result.items.find((t) => t.groupId === g.id)!;
    expect(row.subject).toBeNull();
    expect(row.excerpt).toBe('x'.repeat(80));
  });
});

describe('riešitelia and watching on the dashboard', () => {
  const assign = (ticketId: string, userId: string) =>
    db.insert(ticketAssignees).values({ ticketId, userId });
  const ofGroups = <T extends { groupId: string | null }>(items: T[], ids: string[]) =>
    items.filter((t) => t.groupId !== null && ids.includes(t.groupId));

  it('lists my tickets as a riešiteľ anywhere, and the watched ones without a riešiteľ', async () => {
    const managed = await newGroup(db, 'Managed');
    const foreign = await newGroup(db, 'Foreign');
    const me = await newAdmin(db, 'Ada', [managed.id]);
    const colleague = await newAdmin(db, 'Bob');
    const free = await newTicket({ groupId: managed.id, subject: 'free' });
    const taken = await newTicket({ groupId: managed.id, subject: 'taken' });
    await assign(taken, colleague.id);
    const mineThere = await newTicket({ groupId: foreign.id, subject: 'mine there' });
    await assign(mineThere, me.id);
    await newTicket({ groupId: foreign.id, subject: 'foreign free' });

    const result = await getDashboardTickets(db, me.id);
    const items = ofGroups(result.items, [managed.id, foreign.id]);
    expect(items.map((t) => [t.subject, t.hasAssignee]).sort()).toEqual(
      [
        ['free', false],
        ['mine there', true],
      ].sort(),
    );
    expect(items.some((t) => t.id === free)).toBe(true);
  });

  it('a manager who stopped watching sees only their own; an admin who watches sees the rest', async () => {
    const g = await newGroup(db, 'Watch');
    const manager = await newAdmin(db, 'Ada', [g.id]);
    const watcher = await newAdmin(db, 'Cyril');
    await setTicketWatch(db, manager.id, g.id, false);
    await setTicketWatch(db, watcher.id, g.id, true);
    const free = await newTicket({ groupId: g.id, subject: 'free' });
    const mine = await newTicket({ groupId: g.id, subject: 'mine' });
    await assign(mine, manager.id);

    const forManager = ofGroups((await getDashboardTickets(db, manager.id)).items, [g.id]);
    expect(forManager.map((t) => t.id)).toEqual([mine]);
    const forWatcher = ofGroups((await getDashboardTickets(db, watcher.id)).items, [g.id]);
    expect(forWatcher.map((t) => t.id)).toEqual([free]);
  });

  it('a client I neither watch nor am on stays off the card; watching it shows its free tickets', async () => {
    const g = await newGroup(db, 'Unwatched');
    const me = await newAdmin(db, 'Ada');
    const free = await newTicket({ groupId: g.id, subject: 'free' });
    expect(ofGroups((await getDashboardTickets(db, me.id)).items, [g.id])).toEqual([]);
    await setTicketWatch(db, me.id, g.id, true);
    const items = ofGroups((await getDashboardTickets(db, me.id)).items, [g.id]);
    expect(items.map((t) => [t.id, t.hasAssignee])).toEqual([[free, false]]);
  });

  it('a ticket without a client assigned to me shows once, marked with a riešiteľ', async () => {
    const me = await newAdmin(db, 'Ada');
    const id = await newTicket({ groupId: null, subject: `no client ${randomUUID()}` });
    await assign(id, me.id);
    const result = await getDashboardTickets(db, me.id);
    const rows = result.items.filter((t) => t.id === id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.hasAssignee).toBe(true);
  });

  it('a ticket without a client that has another riešiteľ is theirs, not on my card', async () => {
    const me = await newAdmin(db, 'Ada');
    const colleague = await newAdmin(db, 'Bob');
    const id = await newTicket({ groupId: null, subject: `no client ${randomUUID()}` });
    expect((await getDashboardTickets(db, me.id)).items.map((t) => t.id)).toContain(id);
    await assign(id, colleague.id);
    expect((await getDashboardTickets(db, me.id)).items.map((t) => t.id)).not.toContain(id);
  });
});

describe('countDashboardTickets', () => {
  it("counts the card's tickets: mine, the watched ones without a riešiteľ, no client", async () => {
    const g = await newGroup(db, 'Count');
    const other = await newGroup(db, 'Count other');
    const me = await newAdmin(db, 'Ada', [g.id]);
    const colleague = await newAdmin(db, 'Bob');
    await newTicket({ groupId: g.id, status: 'new' });
    await newTicket({ groupId: g.id, status: 'in_progress' });
    await newTicket({ groupId: g.id, status: 'resolved' });
    const taken = await newTicket({ groupId: g.id, status: 'new' });
    await db.insert(ticketAssignees).values({ ticketId: taken, userId: colleague.id });
    const mine = await newTicket({ groupId: other.id, status: 'new' });
    await db.insert(ticketAssignees).values({ ticketId: mine, userId: me.id });
    await newTicket({ groupId: other.id, status: 'new' });
    await newTicket({ groupId: null, status: 'new' });
    const count = await countDashboardTickets(db, me.id);
    // 2 watched without a riešiteľ + 1 mine + 1 without a client, plus the shared database's
    // other tickets without a client.
    expect(count).toBeGreaterThanOrEqual(4);
  });

  it('an admin who manages and watches nothing counts only the tickets without a client', async () => {
    const me = await newAdmin(db, 'Ada');
    const card = await getDashboardTickets(db, me.id);
    expect(card.items.every((t) => t.groupId === null)).toBe(true);
  });
});
