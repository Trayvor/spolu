import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  TicketEvents,
  type TicketDto,
  type TicketRatingList,
  type TicketRatingSummary,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { ADMINS_ROOM, userRoom } from '../../infra/realtime/rooms.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { TICKET_UNSEEN_KINDS } from '../notifications/unseen-kinds.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { tickets } from './schema.js';

const KEY = 'test-tickets-key-ratings-01234';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `r${randomUUID().replaceAll('-', '').slice(0, 20)}`;
const DAY = 86_400_000;

describe('ticket rating (2026-10-19)', () => {
  let test: TestApp;
  const admins: string[] = [];

  beforeAll(async () => {
    // Lower write limit (config.ticketRatingsPerMinute): the 429 test sends a few requests.
    test = await buildTestApp({ config: { ticketsApiKey: KEY, ticketRatingsPerMinute: 6 } });
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'GET' | 'PUT' | 'PATCH', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function group() {
    const h = host();
    return {
      ...(await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` })),
      host: h,
    };
  }
  async function admin(name = 'Ad Min') {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel', name = 'Jana') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name, emailVerified: true }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, name, cookie: await loginAs(test.app, c.email) };
  }
  /** A ticket from the intake whose initiator is `email` (a new person becomes a ziadatel). */
  async function ticket(g: { host: string }, email: string) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Login fails', email, instance_url: `https://${g.host}.egrant.sk` },
    });
    return res.json<{ id: string; number: number }>();
  }
  /** A client group with a manager, a ziadatel initiator and a resolved ticket of theirs. */
  async function resolvedSetup() {
    const g = await group();
    const manager = await admin('Manažér');
    await addManager(db(), g.id, manager.id);
    const email = newEmail();
    const t = await ticket(g, email);
    const [row] = await db().select().from(tickets).where(eq(tickets.id, t.id));
    const z = {
      id: row!.requesterUserId!,
      email,
      cookie: await loginAs(test.app, email),
    };
    await db().update(user).set({ name: 'Žofia' }).where(eq(user.id, z.id));
    expect(
      (await call('PATCH', `/api/tickets/${t.id}`, manager.cookie, { status: 'resolved' }))
        .statusCode,
    ).toBe(200);
    return { g, manager, z, t };
  }
  const rate = (id: string, cookie: string, body: object) =>
    call('PUT', `/api/tickets/${id}/rating`, cookie, body);
  const get = async (id: string, cookie: string) =>
    (await call('GET', `/api/tickets/${id}`, cookie)).json<TicketDto>();
  const backdate = (id: string, days: number) =>
    db()
      .update(tickets)
      .set({ resolvedAt: new Date(Date.now() - days * DAY) })
      .where(eq(tickets.id, id));
  const ratedEvents = (ticketId: string) =>
    db()
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.kind, 'ticket.rated'),
          sql`${notificationEvents.payload}->>'ticketId' = ${ticketId}`,
        ),
      );

  describe('the ticket DTO', () => {
    it('the initiator sees canRate and editableUntil on a resolved ticket, and their own rating', async () => {
      const { z, t } = await resolvedSetup();
      const before = await get(t.id, z.cookie);
      expect(before.rating).toMatchObject({ mine: null, canRate: true });
      const until = new Date(before.rating.editableUntil!).getTime();
      const resolved = new Date(before.resolvedAt!).getTime();
      expect(until - resolved).toBe(14 * DAY);
      expect(before.ratings).toBeNull();
      const res = await rate(t.id, z.cookie, { value: 'up', comment: 'Ďakujem' });
      expect(res.statusCode).toBe(200);
      const dto = res.json<TicketDto>();
      expect(dto.rating.mine).toMatchObject({ value: 'up', comment: 'Ďakujem' });
      expect(dto.ratings).toBeNull();
    });

    it('a client of the group who is not the initiator gets no rating and ratings null', async () => {
      const { g, z, t } = await resolvedSetup();
      await rate(t.id, z.cookie, { value: 'down', comment: 'secret' });
      const c = await member(g.id, 'client', 'Cyril');
      const dto = await get(t.id, c.cookie);
      expect(dto.rating).toEqual({ mine: null, canRate: false, editableUntil: null });
      expect(dto.ratings).toBeNull();
      expect(JSON.stringify(dto)).not.toContain('secret');
    });

    it('an admin gets every rating with the names and canRate false', async () => {
      const { manager, z, t } = await resolvedSetup();
      await rate(t.id, z.cookie, { value: 'down', comment: 'Nefunguje' });
      const dto = await get(t.id, manager.cookie);
      expect(dto.rating).toEqual({ mine: null, canRate: false, editableUntil: null });
      expect(dto.ratings).toEqual([
        expect.objectContaining({
          userId: z.id,
          name: 'Žofia',
          value: 'down',
          comment: 'Nefunguje',
        }),
      ]);
    });

    it('an admin who is neither a riešiteľ nor a manager of the client also gets every rating and comment', async () => {
      const { z, t } = await resolvedSetup();
      await rate(t.id, z.cookie, { value: 'down', comment: 'Nefunguje' });
      const other = await admin('Iný');
      const dto = await get(t.id, other.cookie);
      expect(dto.ratings?.map((r) => r.comment)).toEqual(['Nefunguje']);
    });

    it('canRate is false 15 days after resolving and on a reopened ticket; mine is still there', async () => {
      const { manager, z, t } = await resolvedSetup();
      await rate(t.id, z.cookie, { value: 'up' });
      await backdate(t.id, 15);
      const late = await get(t.id, z.cookie);
      expect(late.rating).toMatchObject({ canRate: false, editableUntil: null });
      expect(late.rating.mine?.value).toBe('up');
      await call('PATCH', `/api/tickets/${t.id}`, manager.cookie, { status: 'in_progress' });
      const open = await get(t.id, z.cookie);
      expect(open.rating).toMatchObject({ canRate: false, mine: { value: 'up' } });
      // Resolved again: a new window from the new resolved_at.
      await call('PATCH', `/api/tickets/${t.id}`, manager.cookie, { status: 'resolved' });
      expect((await get(t.id, z.cookie)).rating.canRate).toBe(true);
      expect((await rate(t.id, z.cookie, { value: 'down' })).statusCode).toBe(200);
    });
  });

  describe('PUT /tickets/:id/rating', () => {
    it('the initiator rates a resolved ticket and can change it; an absent comment is kept', async () => {
      const { z, t } = await resolvedSetup();
      await rate(t.id, z.cookie, { value: 'up', comment: '  dobre  ' });
      const res = await rate(t.id, z.cookie, { value: 'down' });
      expect(res.statusCode).toBe(200);
      expect(res.json<TicketDto>().rating.mine).toMatchObject({ value: 'down', comment: 'dobre' });
      const cleared = await rate(t.id, z.cookie, { value: 'down', comment: '' });
      expect(cleared.json<TicketDto>().rating.mine?.comment).toBeNull();
    });

    it('404 for an outsider before anything else, 403 for an admin and for another client', async () => {
      const { g, manager, t } = await resolvedSetup();
      const outsider = await member((await group()).id, 'client', 'Out');
      expect((await rate(t.id, outsider.cookie, { value: 'meh' })).statusCode).toBe(404);
      expect((await rate(randomUUID(), outsider.cookie, { value: 'up' })).statusCode).toBe(404);
      expect((await rate(t.id, manager.cookie, { value: 'up' })).json()).toEqual({
        error: 'forbidden',
      });
      const c = await member(g.id, 'client', 'Cyril');
      expect((await rate(t.id, c.cookie, { value: 'up' })).statusCode).toBe(403);
    });

    it('an admin initiator cannot rate their own ticket', async () => {
      const g = await group();
      const a = await admin('Initiator');
      const t = await ticket(g, a.email);
      await call('PATCH', `/api/tickets/${t.id}`, a.cookie, { status: 'resolved' });
      const dto = await get(t.id, a.cookie);
      expect(dto.requester.userId).toBe(a.id);
      expect(dto.rating.canRate).toBe(false);
      expect((await rate(t.id, a.cookie, { value: 'up' })).statusCode).toBe(403);
    });

    it('409 ticket_not_resolved on an open ticket, 409 rating_closed 15 days after resolving', async () => {
      const { manager, z, t } = await resolvedSetup();
      await call('PATCH', `/api/tickets/${t.id}`, manager.cookie, { status: 'in_progress' });
      expect((await rate(t.id, z.cookie, { value: 'up' })).json()).toEqual({
        error: 'ticket_not_resolved',
      });
      await call('PATCH', `/api/tickets/${t.id}`, manager.cookie, { status: 'resolved' });
      await backdate(t.id, 15);
      const closed = await rate(t.id, z.cookie, { value: 'up' });
      expect(closed.statusCode).toBe(409);
      expect(closed.json()).toEqual({ error: 'rating_closed' });
    });

    it('400 for a bad value or a long comment', async () => {
      const { z, t } = await resolvedSetup();
      expect((await rate(t.id, z.cookie, { value: 'meh' })).statusCode).toBe(400);
      expect(
        (await rate(t.id, z.cookie, { value: 'up', comment: 'x'.repeat(1001) })).statusCode,
      ).toBe(400);
    });

    it('429 after the per-minute write limit', async () => {
      const { z, t } = await resolvedSetup();
      const codes: number[] = [];
      for (let i = 0; i < 7; i++)
        codes.push((await rate(t.id, z.cookie, { value: 'up' })).statusCode);
      expect(codes.slice(0, 6).every((c) => c === 200)).toBe(true);
      expect(codes[6]).toBe(429);
    });

    it('emits ticket:rated to the admins room and the rater room, not the group room', async () => {
      const { g, z, t } = await resolvedSetup();
      const sent: { rooms: unknown; event: string; payload: unknown }[] = [];
      const spy = vi.spyOn(test.app.io, 'to').mockImplementation(
        (rooms) =>
          ({
            emit: (event: string, payload: unknown) => {
              sent.push({ rooms, event, payload });
              return true;
            },
          }) as never,
      );
      try {
        await rate(t.id, z.cookie, { value: 'down', comment: 'never in the event' });
      } finally {
        spy.mockRestore();
      }
      const rated = sent.filter((s) => s.event === TicketEvents.rated);
      expect(rated).toEqual([
        {
          rooms: [ADMINS_ROOM, userRoom(z.id)],
          event: 'ticket:rated',
          payload: { ticketId: t.id, groupId: g.id },
        },
      ]);
      // No `ticket:updated`: list rows do not show ratings.
      expect(sent.some((s) => s.event === TicketEvents.updated)).toBe(false);
    });
  });

  describe('the ticket.rated notification', () => {
    it('a down rating notifies the admin managers once per rating, never the rater, never with the comment', async () => {
      const { g, manager, z, t } = await resolvedSetup();
      const c = await member(g.id, 'client', 'Cyril'); // a client watcher: never notified
      await rate(t.id, z.cookie, { value: 'up' });
      expect(await ratedEvents(t.id)).toHaveLength(0);
      await rate(t.id, z.cookie, { value: 'down', comment: 'Nefunguje' });
      await rate(t.id, z.cookie, { value: 'up' });
      await rate(t.id, z.cookie, { value: 'down' });
      const events = await ratedEvents(t.id);
      expect(events.map((e) => e.userId)).toEqual([manager.id]);
      expect(events.map((e) => e.userId)).not.toContain(c.id);
      expect(events.map((e) => e.userId)).not.toContain(z.id);
      expect(Object.keys(events[0]!.payload as object).sort()).toEqual([
        'groupId',
        'number',
        'subject',
        'ticketId',
        'value',
      ]);
      expect(events[0]!.payload).toMatchObject({ value: 'down', number: t.number });
    });

    it('a down rating notifies the admin riešitelia, not the client riešitelia', async () => {
      const { g, manager, z, t } = await resolvedSetup();
      const solver = await admin('Riešiteľ');
      const clientSolver = await member(g.id, 'client', 'Klient');
      for (const id of [solver.id, clientSolver.id]) {
        expect(
          (await call('PUT', `/api/tickets/${t.id}/assignees/${id}`, manager.cookie)).statusCode,
        ).toBe(200);
      }
      await rate(t.id, z.cookie, { value: 'down' });
      expect((await ratedEvents(t.id)).map((e) => e.userId)).toEqual([solver.id]);
    });

    it('without an admin riešiteľ it notifies the admins who watch the client (its managers)', async () => {
      const { g, manager, z, t } = await resolvedSetup();
      const clientSolver = await member(g.id, 'client', 'Klient');
      await call('PUT', `/api/tickets/${t.id}/assignees/${clientSolver.id}`, manager.cookie);
      await rate(t.id, z.cookie, { value: 'down' });
      expect((await ratedEvents(t.id)).map((e) => e.userId)).toEqual([manager.id]);
    });

    it('is not an unseen-change kind (the partial index stays valid)', () => {
      expect(TICKET_UNSEEN_KINDS as readonly string[]).not.toContain('ticket.rated');
    });
  });

  describe('summary and list (admins)', () => {
    it('every admin, also one who manages no client, gets the totals and the comments; 403 for a client', async () => {
      const { g, z, t } = await resolvedSetup();
      await rate(t.id, z.cookie, { value: 'down', comment: 'Pomaly' });
      const other = await admin('Nikto');
      const summary = await call(
        'GET',
        `/api/tickets/ratings/summary?days=30&groupId=${g.id}`,
        other.cookie,
      );
      expect(summary.statusCode).toBe(200);
      expect(summary.json<TicketRatingSummary>()).toEqual({
        days: 30,
        up: 0,
        down: 1,
        resolved: 1,
        rated: 1,
      });
      const list = await call('GET', `/api/tickets/ratings?groupId=${g.id}`, other.cookie);
      expect(list.statusCode).toBe(200);
      expect(list.json<TicketRatingList>().items).toEqual([
        expect.objectContaining({
          ticketId: t.id,
          number: t.number,
          raterId: z.id,
          raterName: 'Žofia',
          value: 'down',
          comment: 'Pomaly',
        }),
      ]);
      expect((await call('GET', '/api/tickets/ratings', z.cookie)).statusCode).toBe(403);
      expect((await call('GET', '/api/tickets/ratings/summary', z.cookie)).statusCode).toBe(403);
    });

    it('400 for days=7 or a bad cursor; /tickets/ratings is the list, not a ticket', async () => {
      const a = await admin();
      expect((await call('GET', '/api/tickets/ratings?days=7', a.cookie)).statusCode).toBe(400);
      expect((await call('GET', '/api/tickets/ratings/summary?days=7', a.cookie)).statusCode).toBe(
        400,
      );
      expect((await call('GET', '/api/tickets/ratings?cursor=bad', a.cookie)).json()).toEqual({
        error: 'invalid_filter',
      });
      const page = await call('GET', '/api/tickets/ratings', a.cookie);
      expect(page.statusCode).toBe(200);
      expect(page.json<TicketRatingList>()).toHaveProperty('items');
    });
  });

  it('deleting the rater deletes their ratings (cascade)', async () => {
    const { z, t } = await resolvedSetup();
    await rate(t.id, z.cookie, { value: 'up' });
    await db()
      .delete(user)
      .where(inArray(user.id, [z.id]));
    const a = await admin();
    expect((await get(t.id, a.cookie)).ratings).toEqual([]);
  });
  describe('audit rows (2026-10-19)', () => {
    const ratingRows = async (ticketId: string) =>
      (await auditRowsOf(db(), ticketId)).filter((r) => r.entityType === 'ticket_rating');

    it('a first rating writes ticket_rating created: the thumbs, and only that a comment was added', async () => {
      const { g, z, t } = await resolvedSetup();
      expect(
        (await rate(t.id, z.cookie, { value: 'up', comment: 'Ďakujem pekne' })).statusCode,
      ).toBe(200);
      const rows = await ratingRows(t.id);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        action: 'created',
        category: 'general',
        actorKind: 'user',
        actorUserId: z.id,
        groupId: g.id,
        entityId: t.id,
        entityLabel: `#${t.number} Login fails`,
        changes: { rating: { to: 'up' }, comment: { changed: true } },
      });
      expect(JSON.stringify(rows)).not.toContain('Ďakujem');
    });

    it('a change writes updated with the thumbs diff and "comment changed"; an unchanged write none', async () => {
      const { z, t } = await resolvedSetup();
      await rate(t.id, z.cookie, { value: 'up' });
      await rate(t.id, z.cookie, { value: 'down' });
      await rate(t.id, z.cookie, { value: 'down', comment: 'Pomaly' });
      // The same thumbs with the comment absent (kept): nothing changed, no row.
      await rate(t.id, z.cookie, { value: 'down' });
      await rate(t.id, z.cookie, { value: 'down', comment: '' });
      const rows = await ratingRows(t.id);
      expect(rows.map((r) => [r.action, r.changes])).toEqual([
        ['created', { rating: { to: 'up' } }],
        ['updated', { rating: { from: 'up', to: 'down' } }],
        ['updated', { comment: { changed: true } }],
        ['updated', { comment: { changed: true } }],
      ]);
      expect(JSON.stringify(rows)).not.toContain('Pomaly');
    });

    it('a refused rating writes no row', async () => {
      const { manager, t } = await resolvedSetup();
      expect((await rate(t.id, manager.cookie, { value: 'up' })).statusCode).toBe(403);
      expect(await ratingRows(t.id)).toEqual([]);
    });
  });
});
