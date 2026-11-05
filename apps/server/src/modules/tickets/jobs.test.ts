import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationKind } from '@spolu/shared';
import { ErrorCodes, TICKET_CONFIRM_DAYS } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { userActor } from '../audit/actor.js';
import { addManager } from '../groups/managers.js';
import { addMembership, removeMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { InvalidTicketStateError, declineTicket } from './lifecycle.js';
import { AUTO_RESOLVE_JOB, autoResolveDue } from './jobs.js';
import { tickets } from './schema.js';
import { getTicketRow } from './service.js';

const KEY = 'test-tickets-key-autoresolve-01';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `ar${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;
const MIN = 60_000;
const DAY = 86_400_000;

describe('automatic resolve after five days (ticket lifecycle rework, 5.3)', () => {
  let test: TestApp;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const run = (now: Date) =>
    autoResolveDue({ deps: test.deps, io: test.app.io, log: test.app.log }, now);
  async function group() {
    const h = host();
    return { ...(await createGroup(db(), { name: 'Mesto', egrantUrl: `https://${h}` })), host: h };
  }
  async function manager(groupId: string) {
    const a = await addAdmin(db(), { email: newEmail(), name: 'Ad Min' });
    admins.push(a.id);
    await addManager(db(), groupId, a.id);
    return a;
  }
  async function author(groupId: string) {
    const c = await createUnverifiedClient(db(), newEmail());
    await addMembership(db(), c.id, groupId, 'ziadatel');
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  /** An in-progress ticket of `z`, marked `ageMs` before `now`. */
  async function marked(g: { host: string }, z: { email: string }, adminId: string, at: Date) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Pomoc', email: z.email, instance_url: `https://${g.host}` },
    });
    const { id } = res.json<{ id: string }>();
    await db()
      .update(tickets)
      .set({ status: 'in_progress', adminDoneAt: at, adminDoneBy: adminId })
      .where(eq(tickets.id, id));
    return id;
  }
  const eventsOf = (ticketId: string, userId: string, kind: NotificationKind) =>
    db()
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.userId, userId),
          eq(notificationEvents.kind, kind),
          sql`${notificationEvents.payload}->>'ticketId' = ${ticketId}`,
        ),
      );
  const statusOf = async (id: string) => (await getTicketRow(db(), id))!.status;
  const old = (now: Date, ms: number) => new Date(now.getTime() - ms);
  const due = TICKET_CONFIRM_DAYS * DAY + MIN;

  async function setup() {
    const g = await group();
    const m = await manager(g.id);
    const peer = await manager(g.id);
    const z = await author(g.id);
    return { g, m, peer, z };
  }

  it('resolves a mark five days and a minute old, audited by the job, tells the audience, opens rating', async () => {
    const { g, m, peer, z } = await setup();
    const now = new Date();
    const id = await marked(g, z, m.id, old(now, due));

    expect(await run(now)).toBeGreaterThanOrEqual(1);

    const row = (await getTicketRow(db(), id))!;
    expect(row.status).toBe('resolved');
    expect(row.resolvedAt).not.toBeNull();
    expect(row.adminDoneAt).toBeNull();
    const audit = (await auditRowsOf(db(), id)).filter((r) => r.action === 'updated');
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0])).toContain(AUTO_RESOLVE_JOB);
    expect(await eventsOf(id, z.id, 'ticket.resolved')).toHaveLength(1);
    expect(await eventsOf(id, peer.id, 'ticket.resolved')).toHaveLength(1);
    expect(await eventsOf(id, m.id, 'ticket.resolved')).toHaveLength(1);

    // The author can rate it: resolved_at is what opens the rating.
    const rated = await test.app.inject({
      method: 'PUT',
      url: `/api/tickets/${id}/rating`,
      headers: { cookie: z.cookie },
      payload: { value: 'up' },
    });
    expect(rated.statusCode, rated.body).toBeLessThan(300);
  });

  it('leaves a mark four days and 23 hours old', async () => {
    const { g, m, z } = await setup();
    const now = new Date();
    const id = await marked(g, z, m.id, old(now, 4 * DAY + 23 * 3_600_000));
    await run(now);
    expect(await statusOf(id)).toBe('in_progress');
  });

  it('leaves a declined ticket and a second run changes and sends nothing', async () => {
    const { g, m, peer, z } = await setup();
    const now = new Date();
    const declined = await marked(g, z, m.id, old(now, due));
    await declineTicket(db(), declined, userActor(z));
    const dueOne = await marked(g, z, m.id, old(now, due));

    await run(now);
    expect(await statusOf(declined)).toBe('in_progress');
    expect(await statusOf(dueOne)).toBe('resolved');
    const before = (await auditRowsOf(db(), dueOne)).length;
    const events = (await eventsOf(dueOne, peer.id, 'ticket.resolved')).length;

    expect(await run(now)).toBe(0);
    expect((await auditRowsOf(db(), dueOne)).length).toBe(before);
    expect(await eventsOf(dueOne, peer.id, 'ticket.resolved')).toHaveLength(events);
  });

  it('skips a row another transaction holds; the next run takes it', async () => {
    const { g, m, z } = await setup();
    const now = new Date();
    const id = await marked(g, z, m.id, old(now, due));
    await db().transaction(async (tx) => {
      await tx.select().from(tickets).where(eq(tickets.id, id)).for('update');
      await run(now);
      expect(await statusOf(id)).toBe('in_progress');
    });
    await run(now);
    expect(await statusOf(id)).toBe('resolved');
  });

  it('review focus 1: a decline that commits first wins; the job leaves it in progress', async () => {
    const { g, m, z } = await setup();
    const now = new Date();
    const id = await marked(g, z, m.id, old(now, due));
    await db().transaction(async (tx) => {
      const [row] = await tx.select().from(tickets).where(eq(tickets.id, id)).for('update');
      await declineTicket(tx, row!.id, userActor(z));
      await run(now); // meanwhile: the row is locked and skipped
    });
    expect(await run(now)).toBe(0); // after the commit the mark is gone
    const row = (await getTicketRow(db(), id))!;
    expect(row.status).toBe('in_progress');
    expect(row.adminDoneAt).toBeNull();
    expect(row.resolvedAt).toBeNull();
  });

  it('review focus 1: a decline waiting on the job finds the ticket resolved (409)', async () => {
    const { g, m, z } = await setup();
    const now = new Date();
    const id = await marked(g, z, m.id, old(now, due));
    let waiting: Promise<unknown> = Promise.resolve();
    await db().transaction(async (tx) => {
      // The job's own step, held open: lock, resolve, not yet committed.
      const { updateTicket } = await import('./service.js');
      await tx.select().from(tickets).where(eq(tickets.id, id)).for('update');
      waiting = declineTicket(db(), id, userActor(z)).then(
        () => 'declined',
        (error: unknown) => error,
      );
      await updateTicket(tx, id, { status: 'resolved' }, null, undefined, 'in_progress');
    });
    expect(await waiting).toBeInstanceOf(InvalidTicketStateError);
    expect(await statusOf(id)).toBe('resolved');
    expect(ErrorCodes.invalidTicketState).toBeDefined();
  });

  it('review focus 2: an author removed or disabled while marked does not block it', async () => {
    const { g, m, z } = await setup();
    const z2 = await author(g.id);
    const now = new Date();
    const removed = await marked(g, z, m.id, old(now, due));
    const disabled = await marked(g, z2, m.id, old(now, due));
    await removeMembership(db(), g.id, z.id);
    await deactivateUser(db(), z2.id);

    await run(now);
    expect(await statusOf(removed)).toBe('resolved');
    expect(await statusOf(disabled)).toBe('resolved');
  });
});
