import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { TicketStatus } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { newAdmin, newGroup } from '../home/test-fixtures.js';
import { countDashboardTickets, getDashboardTickets } from './dashboard.js';
import { tickets } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

/** Inserts a ticket directly (no initiator, followers or email). */
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

    const result = await getDashboardTickets(db, me.id);
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
    expect(result.unassigned).toBeGreaterThanOrEqual(1);
    expect(result.fresh).toBeGreaterThanOrEqual(1);
    expect(result.total).toBeGreaterThanOrEqual(result.unassigned);
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

describe('countDashboardTickets', () => {
  it('counts my clients exactly and the tickets without a client separately', async () => {
    const g = await newGroup(db, 'Count');
    const other = await newGroup(db, 'Count other');
    const me = await newAdmin(db, 'Ada', [g.id]);
    await newTicket({ groupId: g.id, status: 'new' });
    await newTicket({ groupId: g.id, status: 'in_progress' });
    await newTicket({ groupId: g.id, status: 'resolved' });
    await newTicket({ groupId: other.id, status: 'new' });
    await newTicket({ groupId: null, status: 'new' });
    const counts = await countDashboardTickets(db, me.id);
    expect(counts.mine).toBe(2);
    expect(counts.unassigned).toBeGreaterThanOrEqual(1);
  });

  it('an admin who manages no client has no tickets of their own', async () => {
    const me = await newAdmin(db, 'Ada');
    expect((await countDashboardTickets(db, me.id)).mine).toBe(0);
  });
});
