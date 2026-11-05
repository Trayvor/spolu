import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationKind, TicketDto, TicketListResponse } from '@spolu/shared';
import { ErrorCodes, TICKET_CONFIRM_DAYS } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { systemActor, userActor } from '../audit/actor.js';
import { addManager } from '../groups/managers.js';
import { addMembership, removeMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { clearTicketMark, hasConfirmableAuthor, startTicketOnOpen } from './lifecycle.js';
import { tickets } from './schema.js';
import { getTicketRow, updateTicket } from './service.js';

const KEY = 'test-tickets-key-lifecycle-0001';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `lc${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

describe('a riešiteľ opening a new ticket starts it (ticket lifecycle rework, 5.2)', () => {
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
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  async function group() {
    const h = host();
    return { ...(await createGroup(db(), { name: 'Mesto', egrantUrl: `https://${h}` })), host: h };
  }
  async function manager(groupId: string | null) {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    if (groupId) await addManager(db(), groupId, a.id);
    return { ...a, email, cookie: await loginAs(test.app, email) };
  }
  async function author(groupId: string, role: 'client' | 'ziadatel' = 'ziadatel') {
    const c = await createUnverifiedClient(db(), newEmail());
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  async function intake(g: { host: string } | null, email?: string) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject: 'Pomoc', email, ...(g ? { instance_url: `https://${g.host}` } : {}) },
    });
    return res.json<{ id: string; number: number }>();
  }
  const statusEvents = (ticketId: string, userId: string) =>
    db()
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.userId, userId),
          eq(notificationEvents.kind, 'ticket.status'),
          sql`${notificationEvents.payload}->>'ticketId' = ${ticketId}`,
        ),
      );
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
  const started = (ticketId: string) =>
    db().update(tickets).set({ status: 'in_progress' }).where(eq(tickets.id, ticketId));
  const statusAudit = async (ticketId: string) =>
    (await auditRowsOf(db(), ticketId)).filter((r) => r.action === 'updated');

  it('seen by a riešiteľ: in progress, one audit row, one notification to the author', async () => {
    const g = await group();
    const m = await manager(g.id);
    const z = await author(g.id);
    const t = await intake(g, z.email);

    expect((await call('POST', `/api/tickets/${t.id}/seen`, m.cookie)).statusCode).toBe(204);
    expect((await getTicketRow(db(), t.id))!.status).toBe('in_progress');
    const audit = await statusAudit(t.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: m.id, actorLabel: 'Ad Min' });
    expect(await statusEvents(t.id, z.id)).toHaveLength(1);
    expect(await statusEvents(t.id, m.id)).toHaveLength(0);

    // Reading and opening again change nothing more.
    expect((await call('GET', `/api/tickets/${t.id}`, m.cookie)).statusCode).toBe(200);
    expect((await call('POST', `/api/tickets/${t.id}/seen`, m.cookie)).statusCode).toBe(204);
    expect(await statusAudit(t.id)).toHaveLength(1);
    expect(await statusEvents(t.id, z.id)).toHaveLength(1);
  });

  it('a GET never starts it', async () => {
    const g = await group();
    const m = await manager(g.id);
    const t = await intake(g);
    await call('GET', `/api/tickets/${t.id}`, m.cookie);
    expect((await getTicketRow(db(), t.id))!.status).toBe('new');
  });

  it('seen by an admin who is not a riešiteľ leaves it new while it has riešitelia', async () => {
    const g = await group();
    await manager(g.id);
    const other = await manager(null);
    const t = await intake(g);
    expect((await call('POST', `/api/tickets/${t.id}/seen`, other.cookie)).statusCode).toBe(204);
    expect((await getTicketRow(db(), t.id))!.status).toBe('new');
  });

  it('any admin starts a ticket nobody handles', async () => {
    const g = await group();
    const other = await manager(null);
    const t = await intake(g);
    await call('POST', `/api/tickets/${t.id}/seen`, other.cookie);
    expect((await getTicketRow(db(), t.id))!.status).toBe('in_progress');
  });

  it('a ticket without a client stays new', async () => {
    const a = await manager(null);
    const t = await intake(null);
    await call('POST', `/api/tickets/${t.id}/seen`, a.cookie);
    expect((await getTicketRow(db(), t.id))!.status).toBe('new');
  });

  it('the admin who created the ticket does not start it by opening it', async () => {
    const g = await group();
    const m = await manager(g.id);
    const res = await call('POST', '/api/tickets', m.cookie, { groupId: g.id, subject: 'Môj' });
    const { id } = res.json<{ id: string }>();
    await call('POST', `/api/tickets/${id}/seen`, m.cookie);
    expect((await getTicketRow(db(), id))!.status).toBe('new');
  });

  it('a client opening it starts nothing', async () => {
    const g = await group();
    await manager(g.id);
    const c = await author(g.id, 'client');
    const t = await intake(g, c.email);
    await call('POST', `/api/tickets/${t.id}/seen`, c.cookie);
    expect((await getTicketRow(db(), t.id))!.status).toBe('new');
  });

  it('two openings at once change it once', async () => {
    const g = await group();
    const m = await manager(g.id);
    const t = await intake(g);
    const row = (await getTicketRow(db(), t.id))!;
    const actor = {
      id: m.id,
      email: m.email,
      name: 'Ad Min',
      role: 'admin',
      finance: false,
    } as const;
    const results = await Promise.all([
      startTicketOnOpen(db(), actor, row, userActor(actor)),
      startTicketOnOpen(db(), actor, row, userActor(actor)),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(await statusAudit(t.id)).toHaveLength(1);
  });

  it('reopening a resolved ticket clears the mark fields', async () => {
    const g = await group();
    const m = await manager(g.id);
    const t = await intake(g);
    await db()
      .update(tickets)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        adminDoneAt: new Date(),
        adminDoneBy: m.id,
        adminDoneClearedAt: new Date(),
      })
      .where(eq(tickets.id, t.id));
    const res = await call('PATCH', `/api/tickets/${t.id}`, m.cookie, { status: 'in_progress' });
    expect(res.statusCode).toBe(200);
    const row = (await getTicketRow(db(), t.id))!;
    expect(row.status).toBe('in_progress');
    expect([row.adminDoneAt, row.adminDoneBy, row.adminDoneClearedAt]).toEqual([null, null, null]);
  });

  it('an edit without a status change keeps the mark', async () => {
    const g = await group();
    const m = await manager(g.id);
    const t = await intake(g);
    const doneAt = new Date('2026-11-01T10:00:00Z');
    await db()
      .update(tickets)
      .set({ status: 'in_progress', adminDoneAt: doneAt, adminDoneBy: m.id })
      .where(eq(tickets.id, t.id));
    const res = await call('PATCH', `/api/tickets/${t.id}`, m.cookie, { subject: 'Nový názov' });
    expect(res.statusCode).toBe(200);
    const row = (await getTicketRow(db(), t.id))!;
    expect(row.subject).toBe('Nový názov');
    expect([row.adminDoneAt, row.adminDoneBy]).toEqual([doneAt, m.id]);
  });

  it('a status change by hand clears the mark', async () => {
    const g = await group();
    const m = await manager(g.id);
    const t = await intake(g);
    await db()
      .update(tickets)
      .set({
        status: 'in_progress',
        adminDoneAt: new Date(),
        adminDoneBy: m.id,
        adminDoneClearedAt: new Date(),
      })
      .where(eq(tickets.id, t.id));
    const res = await call('PATCH', `/api/tickets/${t.id}`, m.cookie, { status: 'resolved' });
    expect(res.statusCode).toBe(200);
    const row = (await getTicketRow(db(), t.id))!;
    expect([row.adminDoneAt, row.adminDoneBy, row.adminDoneClearedAt]).toEqual([null, null, null]);
  });

  describe('solved on our side (5.3)', () => {
    const press = (id: string, cookie: string) =>
      call('POST', `/api/tickets/${id}/admin-done`, cookie);

    it('with a confirmable author it sets the mark and tells the author', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);

      const res = await press(t.id, m.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<TicketDto & { askTime: boolean }>();
      expect(body.status).toBe('in_progress');
      expect(body.askTime).toBe(false);
      expect(body.confirmation.adminDoneAt).not.toBeNull();
      expect(body.confirmation.resolvesAt).toBe(
        new Date(
          new Date(body.confirmation.adminDoneAt!).getTime() + TICKET_CONFIRM_DAYS * 86_400_000,
        ).toISOString(),
      );
      const row = (await getTicketRow(db(), t.id))!;
      expect(row.adminDoneBy).toBe(m.id);
      expect(row.resolvedAt).toBeNull();
      expect(await eventsOf(t.id, z.id, 'ticket.awaiting_confirmation')).toHaveLength(1);
      expect(await eventsOf(t.id, z.id, 'ticket.resolved')).toHaveLength(0);
    });

    it('without a confirmable author it resolves at once', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const disabled = await intake(g, z.email);
      const noAccount = await intake(g);
      const byAdmin = await intake(g);
      await db().update(tickets).set({ requesterUserId: m.id }).where(eq(tickets.id, byAdmin.id));
      await deactivateUser(db(), z.id);

      for (const t of [disabled, noAccount, byAdmin]) {
        await started(t.id);
        const res = await press(t.id, m.cookie);
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json<TicketDto>().status).toBe('resolved');
        const row = (await getTicketRow(db(), t.id))!;
        expect(row.resolvedAt).not.toBeNull();
        expect(row.adminDoneAt).toBeNull();
      }
    });

    it('a resolve at once tells the riešitelia as any resolve does', async () => {
      const g = await group();
      const m = await manager(g.id);
      const other = await manager(g.id);
      const t = await intake(g);
      await started(t.id);
      await press(t.id, m.cookie);
      expect(await eventsOf(t.id, other.id, 'ticket.resolved')).toHaveLength(1);
    });

    it('needs in progress and no mark', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const fresh = await intake(g, z.email);
      const conflict = async (id: string) => {
        const res = await press(id, m.cookie);
        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: ErrorCodes.invalidTicketState });
      };
      await conflict(fresh.id);

      const marked = await intake(g, z.email);
      await started(marked.id);
      expect((await press(marked.id, m.cookie)).statusCode).toBe(200);
      await conflict(marked.id);
      expect(await eventsOf(marked.id, z.id, 'ticket.awaiting_confirmation')).toHaveLength(1);

      const resolved = await intake(g, z.email);
      await db().update(tickets).set({ status: 'resolved' }).where(eq(tickets.id, resolved.id));
      await conflict(resolved.id);
    });

    it('a client or a žiadateľ may not; someone who does not read it gets 404', async () => {
      const g = await group();
      const z = await author(g.id);
      const c = await author(g.id, 'client');
      const stranger = await author((await group()).id, 'client');
      const t = await intake(g, z.email);
      await started(t.id);
      expect((await press(t.id, z.cookie)).statusCode).toBe(403);
      expect((await press(t.id, c.cookie)).statusCode).toBe(403);
      expect((await press(t.id, stranger.cookie)).statusCode).toBe(404);
      expect((await getTicketRow(db(), t.id))!.adminDoneAt).toBeNull();
    });

    it('pressing again after a decline sets the mark anew and forgets the clearing', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);
      await press(t.id, m.cookie);
      await call('POST', `/api/tickets/${t.id}/decline`, z.cookie);
      expect((await getTicketRow(db(), t.id))!.adminDoneClearedAt).not.toBeNull();
      expect((await press(t.id, m.cookie)).statusCode).toBe(200);
      const row = (await getTicketRow(db(), t.id))!;
      expect(row.adminDoneAt).not.toBeNull();
      expect(row.adminDoneClearedAt).toBeNull();
    });
  });

  describe('the author confirms (5.3)', () => {
    const confirm = (id: string, cookie: string) =>
      call('POST', `/api/tickets/${id}/confirm`, cookie);

    it('from new, from in progress and with the mark it resolves and clears the mark', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const fresh = await intake(g, z.email);
      const going = await intake(g, z.email);
      await started(going.id);
      const marked = await intake(g, z.email);
      await started(marked.id);
      await call('POST', `/api/tickets/${marked.id}/admin-done`, m.cookie);

      for (const t of [fresh, going, marked]) {
        const res = await confirm(t.id, z.cookie);
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json<TicketDto>().status).toBe('resolved');
        const row = (await getTicketRow(db(), t.id))!;
        expect(row.resolvedAt).not.toBeNull();
        expect([row.adminDoneAt, row.adminDoneBy, row.adminDoneClearedAt]).toEqual([
          null,
          null,
          null,
        ]);
        // The riešiteľ hears the resolve; the author made it.
        expect(await eventsOf(t.id, m.id, 'ticket.resolved')).toHaveLength(1);
        expect(await eventsOf(t.id, z.id, 'ticket.resolved')).toHaveLength(0);
      }
    });

    it('another client and an admin may not; a stranger gets 404; resolved is 409', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const c = await author(g.id, 'client');
      const stranger = await author((await group()).id, 'client');
      const t = await intake(g, z.email);
      await started(t.id);
      expect((await confirm(t.id, c.cookie)).statusCode).toBe(403);
      expect((await confirm(t.id, m.cookie)).statusCode).toBe(403);
      expect((await confirm(t.id, stranger.cookie)).statusCode).toBe(404);
      expect((await getTicketRow(db(), t.id))!.status).toBe('in_progress');

      expect((await confirm(t.id, z.cookie)).statusCode).toBe(200);
      const again = await confirm(t.id, z.cookie);
      expect(again.statusCode).toBe(409);
      expect(again.json()).toEqual({ error: ErrorCodes.invalidTicketState });
    });

    it('on a ticket made on behalf of someone the named person confirms, not the maker', async () => {
      const g = await group();
      const maker = await author(g.id, 'client');
      const named = await author(g.id);
      const res = await call('POST', '/api/tickets', maker.cookie, {
        groupId: g.id,
        subject: 'Za kolegu',
        requesterEmail: named.email,
        requesterName: 'Kolega',
      });
      expect(res.statusCode, res.body).toBe(201);
      const { id } = res.json<{ id: string }>();
      expect((await confirm(id, maker.cookie)).statusCode).toBe(403);
      expect((await confirm(id, named.cookie)).statusCode).toBe(200);
      expect((await getTicketRow(db(), id))!.status).toBe('resolved');
    });
  });

  describe('the author declines (5.3)', () => {
    const decline = (id: string, cookie: string) =>
      call('POST', `/api/tickets/${id}/decline`, cookie);

    it('clears the mark, keeps the status and tells the riešitelia who declined', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);
      await call('POST', `/api/tickets/${t.id}/admin-done`, m.cookie);

      const res = await decline(t.id, z.cookie);
      expect(res.statusCode, res.body).toBe(200);
      const body = res.json<TicketDto>();
      expect(body.status).toBe('in_progress');
      expect(body.confirmation).toMatchObject({ adminDoneAt: null, resolvesAt: null });
      const row = (await getTicketRow(db(), t.id))!;
      expect(row.adminDoneAt).toBeNull();
      expect(row.adminDoneBy).toBeNull();
      expect(row.adminDoneClearedAt).not.toBeNull();
      const events = await eventsOf(t.id, m.id, 'ticket.confirmation_declined');
      expect(events).toHaveLength(1);
      expect(events[0]!.payload).toMatchObject({ actorName: z.name });
      expect(await eventsOf(t.id, z.id, 'ticket.confirmation_declined')).toHaveLength(0);
    });

    it('needs the mark and the author', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const c = await author(g.id, 'client');
      const t = await intake(g, z.email);
      await started(t.id);
      const none = await decline(t.id, z.cookie);
      expect(none.statusCode).toBe(409);
      expect(none.json()).toEqual({ error: ErrorCodes.invalidTicketState });

      await call('POST', `/api/tickets/${t.id}/admin-done`, m.cookie);
      expect((await decline(t.id, c.cookie)).statusCode).toBe(403);
      expect((await decline(t.id, m.cookie)).statusCode).toBe(403);
      expect((await getTicketRow(db(), t.id))!.adminDoneAt).not.toBeNull();
    });
  });

  it('clearTicketMark clears a set mark once and leaves an unmarked ticket alone', async () => {
    const g = await group();
    const m = await manager(g.id);
    const z = await author(g.id);
    const t = await intake(g, z.email);
    await started(t.id);
    await call('POST', `/api/tickets/${t.id}/admin-done`, m.cookie);
    const row = (await getTicketRow(db(), t.id))!;

    const cleared = await clearTicketMark(db(), row, systemActor('test'));
    expect(cleared?.adminDoneAt).toBeNull();
    expect(cleared?.adminDoneClearedAt).not.toBeNull();
    expect(await clearTicketMark(db(), row, systemActor('test'))).toBeNull();
    const again = (await getTicketRow(db(), t.id))!;
    expect(again.adminDoneClearedAt).toEqual(cleared!.adminDoneClearedAt);
  });

  describe('moving a ticket to another client', () => {
    it('a marked ticket loses the mark and its timer and stays in progress', async () => {
      const g = await group();
      const target = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);
      await call('POST', `/api/tickets/${t.id}/admin-done`, m.cookie);

      const res = await call('PUT', `/api/tickets/${t.id}/group`, m.cookie, {
        groupId: target.id,
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<TicketDto>().confirmation).toMatchObject({
        adminDoneAt: null,
        resolvesAt: null,
      });
      const row = (await getTicketRow(db(), t.id))!;
      expect(row.groupId).toBe(target.id);
      expect(row.status).toBe('in_progress');
      expect([row.adminDoneAt, row.adminDoneBy]).toEqual([null, null]);
      expect(row.adminDoneClearedAt).not.toBeNull();
    });

    it('an unmarked ticket records no clearing', async () => {
      const g = await group();
      const target = await group();
      const m = await manager(g.id);
      const t = await intake(g);
      await started(t.id);
      await call('PUT', `/api/tickets/${t.id}/group`, m.cookie, { groupId: target.id });
      expect((await getTicketRow(db(), t.id))!.adminDoneClearedAt).toBeNull();
    });

    it('an earlier clearing survives a move of an unmarked ticket', async () => {
      const g = await group();
      const target = await group();
      const m = await manager(g.id);
      const t = await intake(g);
      const clearedAt = new Date('2026-11-01T10:00:00Z');
      await db()
        .update(tickets)
        .set({ status: 'in_progress', adminDoneClearedAt: clearedAt })
        .where(eq(tickets.id, t.id));
      await call('PUT', `/api/tickets/${t.id}/group`, m.cookie, { groupId: target.id });
      expect((await getTicketRow(db(), t.id))!.adminDoneClearedAt).toEqual(clearedAt);
    });
  });

  describe('two actions at once change the ticket once', () => {
    const resolvedRows = async (id: string) =>
      (await auditRowsOf(db(), id)).filter(
        (r) => (r.changes as { status?: { to?: string } }).status?.to === 'resolved',
      );
    const codes = (results: { statusCode: number }[]) =>
      results.map((r) => r.statusCode).sort((a, b) => a - b);

    it('two confirms: one 200, one 409, one audit row, one notification', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);
      const url = `/api/tickets/${t.id}/confirm`;
      const results = await Promise.all([call('POST', url, z.cookie), call('POST', url, z.cookie)]);
      expect(codes(results)).toEqual([200, 409]);
      expect(await resolvedRows(t.id)).toHaveLength(1);
      expect(await eventsOf(t.id, m.id, 'ticket.resolved')).toHaveLength(1);
    });

    it('two presses without an author: one 200, one 409, one row, one notification', async () => {
      const g = await group();
      const m = await manager(g.id);
      const other = await manager(g.id);
      const t = await intake(g);
      await started(t.id);
      const url = `/api/tickets/${t.id}/admin-done`;
      const results = await Promise.all([call('POST', url, m.cookie), call('POST', url, m.cookie)]);
      expect(codes(results)).toEqual([200, 409]);
      expect(await resolvedRows(t.id)).toHaveLength(1);
      expect(await eventsOf(t.id, other.id, 'ticket.resolved')).toHaveLength(1);
    });

    it('a confirm racing an admin’s PATCH records one resolve', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);
      await Promise.all([
        call('POST', `/api/tickets/${t.id}/confirm`, z.cookie),
        call('PATCH', `/api/tickets/${t.id}`, m.cookie, { status: 'resolved' }),
      ]);
      expect(await resolvedRows(t.id)).toHaveLength(1);
      expect((await eventsOf(t.id, z.id, 'ticket.resolved')).length).toBeLessThanOrEqual(1);
      expect((await eventsOf(t.id, m.id, 'ticket.resolved')).length).toBeLessThanOrEqual(1);
    });

    it('a resolve that needs in progress leaves a ticket moved back to new alone', async () => {
      const g = await group();
      const t = await intake(g);
      const result = await updateTicket(
        db(),
        t.id,
        { status: 'resolved' },
        null,
        systemActor('test'),
        'in_progress',
      );
      expect(result).toMatchObject({ statusChanged: false, fieldsChanged: false });
      expect((await getTicketRow(db(), t.id))!.status).toBe('new');
      expect(await auditRowsOf(db(), t.id)).toHaveLength(1);
    });
  });

  describe('who may confirm and decline', () => {
    const post = (id: string, action: string, cookie: string) =>
      call('POST', `/api/tickets/${id}/${action}`, cookie);

    it('an admin author gets 403 on confirm', async () => {
      const g = await group();
      const m = await manager(g.id);
      const t = await intake(g);
      await started(t.id);
      await db().update(tickets).set({ requesterUserId: m.id }).where(eq(tickets.id, t.id));
      expect((await post(t.id, 'confirm', m.cookie)).statusCode).toBe(403);
      expect((await getTicketRow(db(), t.id))!.status).toBe('in_progress');
    });

    it('a removed author gets 404 on confirm and decline', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);
      await post(t.id, 'admin-done', m.cookie);
      await removeMembership(db(), g.id, z.id);
      expect((await post(t.id, 'confirm', z.cookie)).statusCode).toBe(404);
      expect((await post(t.id, 'decline', z.cookie)).statusCode).toBe(404);
      const row = (await getTicketRow(db(), t.id))!;
      expect(row.status).toBe('in_progress');
      expect(row.adminDoneAt).not.toBeNull();
    });

    it('a žiadateľ who is not the author gets 404 on confirm and decline', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const other = await author(g.id);
      const t = await intake(g, z.email);
      await started(t.id);
      await post(t.id, 'admin-done', m.cookie);
      expect((await post(t.id, 'confirm', other.cookie)).statusCode).toBe(404);
      expect((await post(t.id, 'decline', other.cookie)).statusCode).toBe(404);
    });
  });

  it('a decline reaches the admin who pressed when the author is the only riešiteľ', async () => {
    const g = await group();
    const a = await manager(null);
    const z = await author(g.id, 'client');
    const t = await intake(g, z.email);
    await started(t.id);
    const put = await call('PUT', `/api/tickets/${t.id}/assignees/${z.id}`, a.cookie);
    expect(put.statusCode, put.body).toBe(200);
    await call('POST', `/api/tickets/${t.id}/admin-done`, a.cookie);
    expect((await call('POST', `/api/tickets/${t.id}/decline`, z.cookie)).statusCode).toBe(200);
    const events = await eventsOf(t.id, a.id, 'ticket.confirmation_declined');
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({ actorName: z.name });
    expect(await eventsOf(t.id, z.id, 'ticket.confirmation_declined')).toHaveLength(0);
  });

  describe('hasConfirmableAuthor', () => {
    it('a client of the ticket’s group yes; an admin, nobody and a disabled account no', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const row = async (requesterUserId: string | null) => ({ groupId: g.id, requesterUserId });
      expect(await hasConfirmableAuthor(db(), await row(z.id))).toBe(true);
      expect(await hasConfirmableAuthor(db(), await row(m.id))).toBe(false);
      expect(await hasConfirmableAuthor(db(), await row(null))).toBe(false);
      expect(await hasConfirmableAuthor(db(), { groupId: null, requesterUserId: z.id })).toBe(
        false,
      );
      await deactivateUser(db(), z.id);
      expect(await hasConfirmableAuthor(db(), await row(z.id))).toBe(false);
    });

    it('an author whose membership was removed no', async () => {
      const g = await group();
      const z = await author(g.id);
      expect(await hasConfirmableAuthor(db(), { groupId: g.id, requesterUserId: z.id })).toBe(true);
      await removeMembership(db(), g.id, z.id);
      expect(await hasConfirmableAuthor(db(), { groupId: g.id, requesterUserId: z.id })).toBe(
        false,
      );
    });
  });

  describe('the DTO', () => {
    it('carries the mark and what each viewer may do', async () => {
      const g = await group();
      const m = await manager(g.id);
      const z = await author(g.id);
      const t = await intake(g, z.email);
      await db().update(tickets).set({ status: 'in_progress' }).where(eq(tickets.id, t.id));
      const get = async (cookie: string) =>
        (await call('GET', `/api/tickets/${t.id}`, cookie)).json<TicketDto>().confirmation;

      expect(await get(m.cookie)).toEqual({
        adminDoneAt: null,
        resolvesAt: null,
        canMarkDone: true,
        canConfirm: false,
        canDecline: false,
      });
      expect(await get(z.cookie)).toMatchObject({
        canMarkDone: false,
        canConfirm: true,
        canDecline: false,
      });

      const doneAt = new Date('2026-11-01T10:00:00Z');
      await db()
        .update(tickets)
        .set({ adminDoneAt: doneAt, adminDoneBy: m.id })
        .where(eq(tickets.id, t.id));
      const admin = await get(m.cookie);
      expect(admin).toMatchObject({ adminDoneAt: doneAt.toISOString(), canMarkDone: false });
      expect(admin.resolvesAt).toBe(
        new Date(doneAt.getTime() + TICKET_CONFIRM_DAYS * 86_400_000).toISOString(),
      );
      expect(await get(z.cookie)).toMatchObject({ canConfirm: true, canDecline: true });

      await db().update(tickets).set({ status: 'resolved' }).where(eq(tickets.id, t.id));
      expect(await get(z.cookie)).toMatchObject({ canConfirm: false, canMarkDone: false });
    });

    it('another client of the group may not confirm, and no client marks it done', async () => {
      const g = await group();
      const z = await author(g.id, 'client');
      const c = await author(g.id, 'client');
      const t = await intake(g, z.email);
      await started(t.id);
      const get = async (cookie: string) =>
        (await call('GET', `/api/tickets/${t.id}`, cookie)).json<TicketDto>().confirmation;
      expect(await get(c.cookie)).toMatchObject({
        canConfirm: false,
        canDecline: false,
        canMarkDone: false,
      });
      expect(await get(z.cookie)).toMatchObject({ canConfirm: true, canMarkDone: false });
    });

    it('list rows say a ticket awaits confirmation', async () => {
      const g = await group();
      const m = await manager(g.id);
      const a = await intake(g);
      const b = await intake(g);
      await db()
        .update(tickets)
        .set({ status: 'in_progress', adminDoneAt: new Date(), adminDoneBy: m.id })
        .where(eq(tickets.id, a.id));
      const list = (
        await call('GET', `/api/groups/${g.id}/tickets`, m.cookie)
      ).json<TicketListResponse>();
      const by = new Map(list.items.map((i) => [i.id, i.awaitingConfirmation]));
      expect(by.get(a.id)).toBe(true);
      expect(by.get(b.id)).toBe(false);
    });
  });
});
