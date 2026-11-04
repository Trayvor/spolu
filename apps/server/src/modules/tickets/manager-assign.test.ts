import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TicketDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addManager, removeManager } from '../groups/managers.js';
import { startSubstitution } from '../groups/substitutions.js';
import { userActor } from '../audit/actor.js';
import { groupManagers } from '../groups/schema.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { MANAGER_ASSIGN_ACTOR, assignManagers } from './manager-assign.js';
import { getTicketRow, removeAssignee } from './service.js';
import { ticketAssignees, tickets } from './schema.js';

const KEY = 'test-tickets-key-manager-assign-01';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `ma${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

describe('the client’s managers become riešitelia', () => {
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
  async function group() {
    const h = host();
    return { ...(await createGroup(db(), { name: 'Mesto', egrantUrl: `https://${h}` })), host: h };
  }
  async function manager(groupId: string | null, name = 'Ad Min') {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name });
    admins.push(a.id);
    if (groupId) await addManager(db(), groupId, a.id);
    return { ...a, email, cookie: await loginAs(test.app, email) };
  }
  const intake = (h: string | null, requestId?: string) =>
    test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        subject: 'Pomoc',
        ...(h ? { instance_url: `https://${h}` } : {}),
        ...(requestId ? { request_id: requestId } : {}),
      },
    });
  const create = (groupId: string, cookie: string) =>
    test.app.inject({
      method: 'POST',
      url: '/api/tickets',
      headers: { cookie },
      payload: { groupId, subject: 'Nový' },
    });
  const assigneeIds = async (ticketId: string) =>
    (await db().select().from(ticketAssignees).where(eq(ticketAssignees.ticketId, ticketId)))
      .map((r) => r.userId)
      .sort();
  const eventsOf = (ticketId: string, userIds: string[]) =>
    db()
      .select()
      .from(notificationEvents)
      .where(
        and(
          inArray(notificationEvents.userId, userIds),
          sql`${notificationEvents.payload}->>'ticketId' = ${ticketId}`,
        ),
      );

  it('new ticket gets every active manager', async () => {
    const g = await group();
    const [a, b] = [await manager(g.id, 'Anna'), await manager(g.id, 'Boris')];
    const res = await intake(g.host);
    expect(res.statusCode).toBe(201);
    const { id } = res.json<{ id: string }>();
    expect(await assigneeIds(id)).toEqual([a.id, b.id].sort());
    for (const m of [a, b]) {
      const assigned = (await eventsOf(id, [m.id])).filter((e) => e.kind === 'ticket.assigned');
      expect(assigned).toHaveLength(1);
    }
    const rows = (await auditRowsOf(db(), id)).filter((r) => r.action === 'assignee_added');
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ actorKind: 'system', actorLabel: MANAGER_ASSIGN_ACTOR });
    }
  });

  it('the creating manager gets no notification about themselves', async () => {
    const g = await group();
    const [a, b] = [await manager(g.id, 'Anna'), await manager(g.id, 'Boris')];
    const res = await create(g.id, a.cookie);
    expect(res.statusCode).toBe(201);
    const dto = res.json<TicketDto>();
    expect(dto.assignees.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
    const events = await eventsOf(dto.id, [a.id, b.id]);
    expect(events.filter((e) => e.kind === 'ticket.assigned').map((e) => e.userId)).toEqual([b.id]);
  });

  it('ifNone adds nobody when the ticket has a riešiteľ', async () => {
    const g = await group();
    const loose = await manager(null);
    await manager(g.id);
    const { id } = (await intake(null)).json<{ id: string }>();
    const bare = (await getTicketRow(db(), id))!;
    // A ticket of the client with a riešiteľ already.
    const own = (await intake(g.host)).json<{ id: string }>();
    await db().delete(ticketAssignees).where(eq(ticketAssignees.ticketId, own.id));
    await db().insert(ticketAssignees).values({ ticketId: own.id, userId: loose.id });
    const ownRow = (await getTicketRow(db(), own.id))!;
    expect(await assignManagers(db(), ownRow, 'ifNone')).toEqual([]);
    expect(await assigneeIds(own.id)).toEqual([loose.id]);
    expect(await assignManagers(db(), bare, 'ifNone')).toEqual([]);
  });

  it('ifNone gives the managers to a ticket nobody handles', async () => {
    const g = await group();
    const a = await manager(g.id);
    const own = (await intake(g.host)).json<{ id: string }>();
    await db().delete(ticketAssignees).where(eq(ticketAssignees.ticketId, own.id));
    const row = (await getTicketRow(db(), own.id))!;
    expect(await assignManagers(db(), row, 'ifNone')).toEqual([a.id]);
  });

  it('a disabled manager is skipped', async () => {
    const g = await group();
    const [a, gone] = [await manager(g.id), await manager(g.id)];
    await deactivateUser(db(), gone.id);
    const { id } = (await intake(g.host)).json<{ id: string }>();
    expect(await assigneeIds(id)).toEqual([a.id]);
  });

  it('11 managers add 10, earliest group_managers.created_at first', async () => {
    const g = await group();
    const ms: { id: string }[] = [];
    for (let i = 0; i < 11; i++) ms.push(await manager(g.id, `M${i}`));
    // The last one added is the earliest appointed.
    await db()
      .update(groupManagers)
      .set({ createdAt: new Date('2020-01-01T00:00:00Z') })
      .where(and(eq(groupManagers.groupId, g.id), eq(groupManagers.userId, ms[10]!.id)));
    const { id } = (await intake(g.host)).json<{ id: string }>();
    const ids = await assigneeIds(id);
    expect(ids).toHaveLength(10);
    expect(ids).toContain(ms[10]!.id);
    expect(ids).not.toContain(ms[9]!.id);
  });

  it('a client without managers adds nobody', async () => {
    const g = await group();
    const { id } = (await intake(g.host)).json<{ id: string }>();
    expect(await assigneeIds(id)).toEqual([]);
  });

  it('a ticket without a client adds nobody', async () => {
    await group();
    await manager(null);
    const { id } = (await intake(null)).json<{ id: string }>();
    expect(await assigneeIds(id)).toEqual([]);
  });

  it('a repeated intake request_id adds no second row', async () => {
    const g = await group();
    const a = await manager(g.id);
    const requestId = randomUUID();
    const first = (await intake(g.host, requestId)).json<{ id: string }>();
    const second = await intake(g.host, requestId);
    expect(second.statusCode).toBe(200);
    expect(second.json<{ id: string }>().id).toBe(first.id);
    expect(await assigneeIds(first.id)).toEqual([a.id]);
    const assigned = (await eventsOf(first.id, [a.id])).filter((e) => e.kind === 'ticket.assigned');
    expect(assigned).toHaveLength(1);
    expect(
      (await auditRowsOf(db(), first.id)).filter((r) => r.action === 'assignee_added'),
    ).toHaveLength(1);
  });
});

describe('a new manager picks up tickets nobody handles', () => {
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
  async function group() {
    const h = host();
    return { ...(await createGroup(db(), { name: 'Mesto', egrantUrl: `https://${h}` })), host: h };
  }
  async function admin(name = 'Ad Min') {
    const a = await addAdmin(db(), { email: newEmail(), name });
    admins.push(a.id);
    return a;
  }
  const openTicket = async (h: string) =>
    (
      await test.app.inject({
        method: 'POST',
        url: '/api/tickets/intake',
        headers: { authorization: `Bearer ${KEY}` },
        payload: { subject: 'Pomoc', instance_url: `https://${h}` },
      })
    ).json<{ id: string }>().id;
  const assigneeIds = async (ticketId: string) =>
    (await db().select().from(ticketAssignees).where(eq(ticketAssignees.ticketId, ticketId)))
      .map((r) => r.userId)
      .sort();
  const assignedEvents = async (ticketId: string, userId: string) =>
    (
      await db()
        .select()
        .from(notificationEvents)
        .where(
          and(
            eq(notificationEvents.userId, userId),
            sql`${notificationEvents.payload}->>'ticketId' = ${ticketId}`,
          ),
        )
    ).filter((e) => e.kind === 'ticket.assigned');

  it('a new manager becomes a riešiteľ of open tickets without one', async () => {
    const g = await group();
    const [open, started] = [await openTicket(g.host), await openTicket(g.host)];
    await db().update(tickets).set({ status: 'in_progress' }).where(eq(tickets.id, started));
    const a = await admin();
    await addManager(db(), g.id, a.id);
    expect(await assigneeIds(open)).toEqual([a.id]);
    expect(await assigneeIds(started)).toEqual([a.id]);
    expect(await assignedEvents(open, a.id)).toHaveLength(1);
    const rows = (await auditRowsOf(db(), open)).filter((r) => r.action === 'assignee_added');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorKind: 'system', actorLabel: MANAGER_ASSIGN_ACTOR });
  });

  it('tickets with a riešiteľ and resolved tickets are left alone', async () => {
    const g = await group();
    const [handled, resolved, other] = [
      await openTicket(g.host),
      await openTicket(g.host),
      await openTicket(g.host),
    ];
    const first = await admin();
    await db().insert(ticketAssignees).values({ ticketId: handled, userId: first.id });
    await db().update(tickets).set({ status: 'resolved' }).where(eq(tickets.id, resolved));
    const a = await admin();
    await addManager(db(), g.id, a.id);
    expect(await assigneeIds(handled)).toEqual([first.id]);
    expect(await assigneeIds(resolved)).toEqual([]);
    expect(await assigneeIds(other)).toEqual([a.id]);
  });

  it('a derived substitute row counts the same', async () => {
    const g = await group();
    const [owner, substitute] = [await admin('Owner'), await admin('Zastup')];
    await addManager(db(), g.id, owner.id);
    const id = await openTicket(g.host);
    await db().delete(ticketAssignees).where(eq(ticketAssignees.ticketId, id));
    await startSubstitution(
      db(),
      { substitutedId: owner.id, substituteId: substitute.id, endsOn: null },
      userActor(owner),
      '2026-10-19',
    );
    expect(await assigneeIds(id)).toEqual([substitute.id]);
    expect(await assignedEvents(id, substitute.id)).toHaveLength(1);
  });

  it('turning a derived row into an own one gains nothing', async () => {
    const g = await group();
    const [owner, substitute] = [await admin('Owner'), await admin('Zastup')];
    await addManager(db(), g.id, owner.id);
    await startSubstitution(
      db(),
      { substitutedId: owner.id, substituteId: substitute.id, endsOn: null },
      userActor(owner),
      '2026-10-19',
    );
    const id = await openTicket(g.host);
    await db().delete(ticketAssignees).where(eq(ticketAssignees.ticketId, id));
    await addManager(db(), g.id, substitute.id);
    expect(await assigneeIds(id)).toEqual([]);
  });

  it('removing a manager changes no ticket', async () => {
    const g = await group();
    const a = await admin();
    await addManager(db(), g.id, a.id);
    const id = await openTicket(g.host);
    expect(await assigneeIds(id)).toEqual([a.id]);
    await removeManager(db(), g.id, a.id);
    expect(await assigneeIds(id)).toEqual([a.id]);
  });

  it('a riešiteľ removed by hand is not added back while nothing about managers changes', async () => {
    const g = await group();
    const a = await admin();
    await addManager(db(), g.id, a.id);
    const id = await openTicket(g.host);
    await removeAssignee(db(), id, a.id);
    expect((await addManager(db(), g.id, a.id)).changed).toBe(false);
    expect(await assigneeIds(id)).toEqual([]);
  });
});
