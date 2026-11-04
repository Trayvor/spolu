import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TicketDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addManager } from '../groups/managers.js';
import { groupManagers } from '../groups/schema.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { MANAGER_ASSIGN_ACTOR, assignManagers } from './manager-assign.js';
import { getTicketRow } from './service.js';
import { ticketAssignees } from './schema.js';

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
