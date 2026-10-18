import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import type { TicketStatus } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { newClient, newGroup } from '../home/test-fixtures.js';
import {
  getRatingSummary,
  InvalidRatingCursorError,
  listRatings,
  ratingsOfTicket,
  setTicketRating,
} from './ratings.js';
import { ticketRatings, tickets } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const DAY = 86_400_000;
const daysAgo = (d: number, from = new Date()) => new Date(from.getTime() - d * DAY);

/** Inserts a ticket directly. */
async function newTicket(input: {
  groupId: string | null;
  requesterUserId?: string | null;
  status?: TicketStatus;
  resolvedAt?: Date | null;
}) {
  const id = randomUUID();
  const now = new Date();
  const status = input.status ?? 'resolved';
  await db.insert(tickets).values({
    id,
    groupId: input.groupId,
    status,
    source: 'manual',
    subject: 'Ticket',
    requesterUserId: input.requesterUserId ?? null,
    resolvedAt: input.resolvedAt === undefined ? (status === 'resolved' ? now : null) : input.resolvedAt,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

/** A rating written directly, with a chosen `updated_at`. */
async function rated(ticketId: string, userId: string, value: 'up' | 'down', at = new Date()) {
  await db.insert(ticketRatings).values({ ticketId, userId, value, createdAt: at, updatedAt: at });
}

const rowOf = async (ticketId: string, userId: string) =>
  (
    await db
      .select()
      .from(ticketRatings)
      .where(and(eq(ticketRatings.ticketId, ticketId), eq(ticketRatings.userId, userId)))
  )[0];

describe('ticket_ratings table', () => {
  it('refuses a third value and a 1001-character comment', async () => {
    const g = await newGroup(db);
    const c = await newClient(db, g.id);
    const t = await newTicket({ groupId: g.id, requesterUserId: c.id });
    const insert = (value: string, comment: string | null) =>
      db.execute(sql`insert into ticket_ratings (ticket_id, user_id, value, comment)
        values (${t}, ${c.id}, ${value}, ${comment})`);
    await expect(insert('meh', null)).rejects.toMatchObject({ cause: { code: '23514' } });
    await expect(insert('up', 'x'.repeat(1001))).rejects.toMatchObject({
      cause: { code: '23514' },
    });
    await expect(insert('up', '')).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('deleting the ticket deletes its ratings', async () => {
    const g = await newGroup(db);
    const c = await newClient(db, g.id);
    const t = await newTicket({ groupId: g.id, requesterUserId: c.id });
    await rated(t, c.id, 'up');
    await db.delete(tickets).where(eq(tickets.id, t));
    expect(await rowOf(t, c.id)).toBeUndefined();
  });
});

describe('setTicketRating', () => {
  it('inserts, then changes the value and keeps the comment when it is absent', async () => {
    const g = await newGroup(db);
    const c = await newClient(db, g.id);
    const t = await newTicket({ groupId: g.id, requesterUserId: c.id });
    const first = new Date('2026-10-01T10:00:00Z');
    await setTicketRating(db, t, c.id, { value: 'up', comment: 'ok' }, first);
    await setTicketRating(db, t, c.id, { value: 'down' }, new Date(first.getTime() + 60_000));
    const row = await rowOf(t, c.id);
    expect(row).toMatchObject({ value: 'down', comment: 'ok' });
    expect(row!.updatedAt.getTime()).toBeGreaterThan(row!.createdAt.getTime());
    expect(row!.createdAt.toISOString()).toBe(first.toISOString());
  });

  it('a null comment clears it, a new one replaces it', async () => {
    const g = await newGroup(db);
    const c = await newClient(db, g.id);
    const t = await newTicket({ groupId: g.id, requesterUserId: c.id });
    await setTicketRating(db, t, c.id, { value: 'up', comment: 'ok' }, new Date());
    await setTicketRating(db, t, c.id, { value: 'up', comment: 'better' }, new Date());
    expect((await rowOf(t, c.id))!.comment).toBe('better');
    await setTicketRating(db, t, c.id, { value: 'up', comment: null }, new Date());
    expect((await rowOf(t, c.id))!.comment).toBeNull();
  });

  it('turnedDown is true once per rating: up, down yes, up, down no', async () => {
    const g = await newGroup(db);
    const c = await newClient(db, g.id);
    const t = await newTicket({ groupId: g.id, requesterUserId: c.id });
    const seen: boolean[] = [];
    let at = new Date('2026-10-01T10:00:00Z').getTime();
    for (const value of ['up', 'down', 'up', 'down'] as const) {
      at += 1000;
      seen.push((await setTicketRating(db, t, c.id, { value }, new Date(at))).turnedDown);
      if (seen.length === 2) expect((await rowOf(t, c.id))!.downNotifiedAt).not.toBeNull();
    }
    expect(seen).toEqual([false, true, false, false]);
  });

  it('a first rating that is down is due at once', async () => {
    const g = await newGroup(db);
    const c = await newClient(db, g.id);
    const t = await newTicket({ groupId: g.id, requesterUserId: c.id });
    expect((await setTicketRating(db, t, c.id, { value: 'down' }, new Date())).turnedDown).toBe(
      true,
    );
  });
});

describe('ratingsOfTicket', () => {
  it('lists every rater with their name, newest first', async () => {
    const g = await newGroup(db);
    const [a, b] = [await newClient(db, g.id, 'Anna'), await newClient(db, g.id, 'Boris')];
    const t = await newTicket({ groupId: g.id, requesterUserId: a.id });
    await rated(t, a.id, 'up', daysAgo(2));
    await db
      .update(ticketRatings)
      .set({ comment: 'fine' })
      .where(and(eq(ticketRatings.ticketId, t), eq(ticketRatings.userId, a.id)));
    await rated(t, b.id, 'down', daysAgo(1));
    const list = await ratingsOfTicket(db, t);
    expect(list.map((r) => [r.userId, r.name, r.value, r.comment])).toEqual([
      [b.id, 'Boris', 'down', null],
      [a.id, 'Anna', 'up', 'fine'],
    ]);
    expect(typeof list[0]!.ratedAt).toBe('string');
  });
});

describe('getRatingSummary', () => {
  it('counts the period, the client, the resolved tickets with an initiator and the rated ones', async () => {
    const now = new Date();
    const g = await newGroup(db);
    const other = await newGroup(db);
    const c = await newClient(db, g.id);
    const oc = await newClient(db, other.id);
    const resolvedTicket = (groupId: string, requester: string | null, resolvedAt = daysAgo(1)) =>
      newTicket({ groupId, requesterUserId: requester, resolvedAt });
    const [t1, t2, t3] = [
      await resolvedTicket(g.id, c.id),
      await resolvedTicket(g.id, c.id),
      await resolvedTicket(g.id, c.id),
    ];
    await rated(t1, c.id, 'up');
    await rated(t2, c.id, 'up');
    await rated(t3, c.id, 'down');
    await resolvedTicket(g.id, c.id); // resolved, not rated
    await resolvedTicket(g.id, null); // no initiator account: not counted
    // A rating 40 days old, on a ticket resolved 41 days ago: outside the period.
    await rated(await resolvedTicket(g.id, c.id, daysAgo(41)), c.id, 'down', daysAgo(40));
    // An open ticket: never in `resolved`.
    await newTicket({ groupId: g.id, requesterUserId: c.id, status: 'in_progress' });
    const elsewhere = await resolvedTicket(other.id, oc.id);
    await rated(elsewhere, oc.id, 'up');

    expect(await getRatingSummary(db, { days: 30, groupId: g.id }, now)).toEqual({
      days: 30,
      up: 2,
      down: 1,
      resolved: 4,
      rated: 3,
    });
    expect(await getRatingSummary(db, { days: 90, groupId: g.id }, now)).toMatchObject({
      up: 2,
      down: 2,
      resolved: 5,
      rated: 4,
    });
    // Without a client every client counts (other files write here too: lower bounds).
    const all = await getRatingSummary(db, { days: 30 }, now);
    expect(all.up).toBeGreaterThanOrEqual(3);
    expect(all.rated).toBeGreaterThanOrEqual(4);
  });
});

describe('listRatings', () => {
  it('pages by 50 with a cursor and filters by value', async () => {
    const g = await newGroup(db, 'Paged');
    const c = await newClient(db, g.id, 'Rater');
    const base = Date.now() - 5 * DAY;
    for (let i = 0; i < 55; i++) {
      const t = await newTicket({ groupId: g.id, requesterUserId: c.id });
      await rated(t, c.id, i % 5 === 0 ? 'down' : 'up', new Date(base + i * 60_000));
    }
    const now = new Date();
    const first = await listRatings(db, { days: 30, groupId: g.id }, now);
    expect(first.items).toHaveLength(50);
    expect(first.nextCursor).not.toBeNull();
    expect(first.items[0]).toMatchObject({
      groupId: g.id,
      groupName: 'Paged',
      raterId: c.id,
      raterName: 'Rater',
      subject: 'Ticket',
    });
    const times = first.items.map((r) => r.ratedAt);
    expect([...times].sort().reverse()).toEqual(times);
    const second = await listRatings(
      db,
      { days: 30, groupId: g.id, cursor: first.nextCursor! },
      now,
    );
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    const ids = new Set([...first.items, ...second.items].map((r) => r.ticketId));
    expect(ids.size).toBe(55);
    const down = await listRatings(db, { days: 30, groupId: g.id, value: 'down' }, now);
    expect(down.items).toHaveLength(11);
    expect(down.items.every((r) => r.value === 'down')).toBe(true);
  });

  it('a bad cursor throws InvalidRatingCursorError', async () => {
    await expect(listRatings(db, { days: 30, cursor: 'nope' }, new Date())).rejects.toBeInstanceOf(
      InvalidRatingCursorError,
    );
  });
});
