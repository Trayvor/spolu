import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TicketDto, TicketListResponse } from '@spolu/shared';
import { TICKET_CONFIRM_DAYS } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { userActor } from '../audit/actor.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { hasConfirmableAuthor, startTicketOnOpen } from './lifecycle.js';
import { tickets } from './schema.js';
import { getTicketRow } from './service.js';

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
  const call = (method: 'GET' | 'POST' | 'PATCH', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
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
