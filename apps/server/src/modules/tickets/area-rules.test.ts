import { randomUUID } from 'node:crypto';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EgrantTicketAreasResponse, TicketAreaRules, TicketDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpToken } from '../../../test/mcp.js';
import { signEgrantRequest } from '../../infra/http/egrant-signature.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { AREA_AUTOASSIGN_JOB } from './area-rules.js';

const KEY = 'test-tickets-key-area-rules-0123';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `ar${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

describe('automatic riešitelia by area (2026-10-21)', () => {
  let test: TestApp;
  const admins: string[] = [];
  let ip = 0;

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
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function group(name = 'Mesto') {
    const h = host();
    return { ...(await createGroup(db(), { name, egrantUrl: `https://${h}` })), host: h };
  }
  async function admin(name = 'Ad Min', email = newEmail()) {
    const a = await addAdmin(db(), { email, name });
    admins.push(a.id);
    return { ...a, email, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name: 'Klient', emailVerified: true }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, cookie: await loginAs(test.app, c.email) };
  }
  const setRules = (groupId: string, cookie: string, rules: { area: string; userId: string }[]) =>
    call('PUT', `/api/groups/${groupId}/ticket-areas`, cookie, { rules });
  const intake = (h: string | null, area: string | null) =>
    test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        subject: 'Pomoc',
        ...(area ? { area } : {}),
        ...(h ? { instance_url: `https://${h}` } : {}),
      },
    });
  const ticketDto = async (id: string, cookie: string) =>
    (await call('GET', `/api/tickets/${id}`, cookie)).json<TicketDto>();
  const assigneeIds = async (id: string, cookie: string) =>
    (await ticketDto(id, cookie)).assignees.map((a) => a.id).sort();
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
  const egrant = (
    payload: object | string,
    key: string | null = KEY,
    app = test.app,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method: 'PUT',
      url: '/api/egrant/ticket-areas',
      remoteAddress: `10.9.0.${++ip % 250}`,
      headers: {
        ...(key === null ? {} : { authorization: `Bearer ${key}` }),
        'content-type': 'application/json',
        ...headers,
      },
      payload,
    });

  describe('the table (web and MCP routes)', () => {
    it('admins read and replace it; clients and requesters get 404', async () => {
      const g = await group();
      const [a, b] = [await admin('Anna'), await admin('Boris')];
      const empty = await call('GET', `/api/groups/${g.id}/ticket-areas`, a.cookie);
      expect(empty.statusCode).toBe(200);
      expect(empty.json()).toEqual({ rules: [] });

      const saved = await setRules(g.id, a.cookie, [
        { area: ' zend.Projekty ', userId: b.id },
        { area: 'Platby', userId: a.id },
        // The same area key and admin again collapses to the first.
        { area: 'PROJEKTY', userId: b.id },
        // Two admins for one area are fine.
        { area: 'Platby', userId: b.id },
      ]);
      expect(saved.statusCode).toBe(200);
      const expected = [
        { area: 'zend.Projekty', user: { id: b.id, name: 'Boris' } },
        { area: 'Platby', user: { id: a.id, name: 'Anna' } },
        { area: 'Platby', user: { id: b.id, name: 'Boris' } },
      ];
      expect(saved.json<TicketAreaRules>().rules).toEqual(expected);
      expect(
        (await call('GET', `/api/groups/${g.id}/ticket-areas`, a.cookie)).json<TicketAreaRules>()
          .rules,
      ).toEqual(expected);

      for (const role of ['client', 'ziadatel'] as const) {
        const m = await member(g.id, role);
        expect((await call('GET', `/api/groups/${g.id}/ticket-areas`, m.cookie)).statusCode).toBe(
          404,
        );
        expect((await setRules(g.id, m.cookie, [])).statusCode).toBe(404);
      }
      // Unchanged by them.
      expect(
        (await call('GET', `/api/groups/${g.id}/ticket-areas`, a.cookie)).json<TicketAreaRules>()
          .rules,
      ).toHaveLength(3);
      expect((await call('GET', `/api/groups/nope/ticket-areas`, a.cookie)).statusCode).toBe(404);
    });

    it('refuses a client, a disabled admin, an empty area and too many rows', async () => {
      const g = await group();
      const a = await admin();
      const client = await member(g.id, 'client');
      const gone = await admin('Gone');
      await deactivateUser(db(), gone.id);
      for (const rules of [
        [{ area: 'A', userId: client.id }],
        [{ area: 'A', userId: gone.id }],
        [{ area: 'A', userId: 'no-such-user' }],
      ]) {
        const res = await setRules(g.id, a.cookie, rules);
        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'invalid_assignee' });
      }
      expect((await setRules(g.id, a.cookie, [{ area: '   ', userId: a.id }])).statusCode).toBe(
        400,
      );
      const many = Array.from({ length: 201 }, (_, i) => ({ area: `A${i}`, userId: a.id }));
      expect((await setRules(g.id, a.cookie, many)).statusCode).toBe(400);
      expect(
        (await call('GET', `/api/groups/${g.id}/ticket-areas`, a.cookie)).json<TicketAreaRules>()
          .rules,
      ).toEqual([]);
    });

    it('a change writes one ticket_area_rules.updated row; the same table again none', async () => {
      const g = await group('Mesto Audit');
      const [a, b] = [await admin('Anna'), await admin('Boris')];
      await setRules(g.id, a.cookie, [{ area: 'Projekty', userId: b.id }]);
      await setRules(g.id, a.cookie, [{ area: 'Projekty', userId: b.id }]);
      await setRules(g.id, a.cookie, [{ area: 'Platby', userId: a.id }]);
      const rows = (await auditRowsOf(db(), g.id)).filter(
        (r) => r.entityType === 'ticket_area_rules',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        action: 'updated',
        actorKind: 'user',
        actorUserId: a.id,
        groupId: g.id,
        entityLabel: 'Mesto Audit',
        changes: {
          rules: { added: [{ id: `${b.id}:projekty`, label: 'Projekty → Boris' }], removed: [] },
        },
      });
      expect(rows[1]!.changes).toEqual({
        rules: {
          added: [{ id: `${a.id}:platby`, label: 'Platby → Anna' }],
          removed: [{ id: `${b.id}:projekty`, label: 'Projekty → Boris' }],
        },
      });
    });
  });

  describe('assignment on creation', () => {
    it('an eGrant ticket of a matching area gets the admin, notified as ticket.assigned', async () => {
      const g = await group();
      const [a, b] = [await admin('Anna'), await admin('Boris')];
      await setRules(g.id, a.cookie, [{ area: 'zend.Projekty', userId: b.id }]);
      // Case, whitespace, diacritics and the prefix on either side.
      const res = await intake(g.host, '  zend PROJEKTY ');
      expect(res.statusCode).toBe(201);
      const { id } = res.json<{ id: string }>();
      expect(await assigneeIds(id, a.cookie)).toEqual([b.id]);
      const events = await eventsOf(id, [b.id]);
      expect(events.map((e) => e.kind)).toContain('ticket.assigned');
      // The system is the author of the automatic assignment.
      const rows = (await auditRowsOf(db(), id)).filter((r) => r.action === 'assignee_added');
      expect(rows).toEqual([
        expect.objectContaining({ actorKind: 'system', actorLabel: AREA_AUTOASSIGN_JOB }),
      ]);
    });

    it('matches diacritics-insensitively and leaves other areas and clients alone', async () => {
      const g = await group();
      const other = await group();
      const [a, b] = [await admin(), await admin()];
      await setRules(g.id, a.cookie, [{ area: 'Žiadosti o platbu', userId: b.id }]);
      const hit = (await intake(g.host, 'ziadosti  o PLATBU')).json<{ id: string }>();
      expect(await assigneeIds(hit.id, a.cookie)).toEqual([b.id]);
      const miss = (await intake(g.host, 'Projekty')).json<{ id: string }>();
      expect(await assigneeIds(miss.id, a.cookie)).toEqual([]);
      const elsewhere = (await intake(other.host, 'Žiadosti o platbu')).json<{ id: string }>();
      expect(await assigneeIds(elsewhere.id, a.cookie)).toEqual([]);
      const noArea = (await intake(g.host, null)).json<{ id: string }>();
      expect(await assigneeIds(noArea.id, a.cookie)).toEqual([]);
      const noClient = (await intake(null, 'Žiadosti o platbu')).json<{ id: string }>();
      expect(await assigneeIds(noClient.id, a.cookie)).toEqual([]);
    });

    it('a ticket made in the app gets the area admin; its author is never notified of it', async () => {
      const g = await group();
      const [a, b] = [await admin('Anna'), await admin('Boris')];
      await setRules(g.id, a.cookie, [
        { area: 'Projekty', userId: b.id },
        { area: 'Projekty', userId: a.id },
      ]);
      const res = await call('POST', '/api/tickets', a.cookie, {
        groupId: g.id,
        subject: 'Nový',
        area: 'projekty',
      });
      expect(res.statusCode).toBe(201);
      const dto = res.json<TicketDto>();
      expect(dto.assignees.map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
      const events = await eventsOf(dto.id, [a.id, b.id]);
      expect(events.filter((e) => e.kind === 'ticket.assigned').map((e) => e.userId)).toEqual([
        b.id,
      ]);
    });

    it('a client creating a ticket gets the area admin too', async () => {
      const g = await group();
      const [a, b] = [await admin(), await admin()];
      await setRules(g.id, a.cookie, [{ area: 'Platby', userId: b.id }]);
      const client = await member(g.id, 'client');
      const res = await call('POST', '/api/tickets', client.cookie, {
        groupId: g.id,
        body: 'Text',
        area: 'Platby',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<TicketDto>().assignees.map((p) => p.id)).toEqual([b.id]);
    });

    it('a ticket made by MCP gets the area admin; MCP lists and sets the table', async () => {
      const g = await group();
      const [a, b] = [await admin('Anna'), await admin('Boris')];
      const token = await mcpToken(db(), a.id);
      const set = await callTool(test.app, token, 'set_ticket_areas', {
        groupId: g.id,
        rules: [{ area: 'Projekty', userId: b.id }],
      });
      expect(set.isError).toBe(false);
      const listed = await callTool(test.app, token, 'list_ticket_areas', { groupId: g.id });
      expect(listed.json).toEqual({
        rules: [{ area: 'Projekty', user: { id: b.id, name: 'Boris' } }],
      });
      const created = await callTool(test.app, token, 'create_ticket', {
        ticket: { groupId: g.id, subject: 'Z MCP', area: 'zend.projekty' },
      });
      expect(created.isError).toBe(false);
      const id = (created.json as { id: string }).id;
      expect(await assigneeIds(id, a.cookie)).toEqual([b.id]);
      const rows = (await auditRowsOf(db(), g.id)).filter(
        (r) => r.entityType === 'ticket_area_rules',
      );
      expect(rows[0]).toMatchObject({ actorKind: 'mcp', actorUserId: a.id });

      // A read-only token lists but never sets (MCP itself is for admins only).
      const reader = await mcpToken(db(), a.id, 'read');
      expect(
        (await callTool(test.app, reader, 'list_ticket_areas', { groupId: g.id })).isError,
      ).toBe(false);
      const write = await callTool(test.app, reader, 'set_ticket_areas', {
        groupId: g.id,
        rules: [],
      });
      expect(write.isError).toBe(true);
      expect(
        (await call('GET', `/api/groups/${g.id}/ticket-areas`, a.cookie)).json<TicketAreaRules>()
          .rules,
      ).toHaveLength(1);
    });

    it('a disabled admin of a row is skipped', async () => {
      const g = await group();
      const [a, b] = [await admin(), await admin()];
      await setRules(g.id, a.cookie, [{ area: 'Projekty', userId: b.id }]);
      await deactivateUser(db(), b.id);
      const { id } = (await intake(g.host, 'Projekty')).json<{ id: string }>();
      expect(await assigneeIds(id, a.cookie)).toEqual([]);
    });
  });

  describe('a later change', () => {
    it('a new matching area assigns only while the ticket has no riešiteľ', async () => {
      const g = await group();
      const [a, b, c] = [await admin('Anna'), await admin('Boris'), await admin('Cyril')];
      await setRules(g.id, a.cookie, [
        { area: 'Projekty', userId: b.id },
        { area: 'Platby', userId: c.id },
      ]);
      const { id } = (await intake(g.host, 'Iné')).json<{ id: string }>();
      expect(await assigneeIds(id, a.cookie)).toEqual([]);

      const patched = await call('PATCH', `/api/tickets/${id}`, a.cookie, { area: 'projekty' });
      expect(patched.statusCode).toBe(200);
      expect(patched.json<TicketDto>().assignees.map((p) => p.id)).toEqual([b.id]);
      expect((await eventsOf(id, [b.id])).map((e) => e.kind)).toContain('ticket.assigned');

      // It has a riešiteľ now: another mapped area adds nobody.
      await call('PATCH', `/api/tickets/${id}`, a.cookie, { area: 'Platby' });
      expect(await assigneeIds(id, a.cookie)).toEqual([b.id]);
      // A change of other fields assigns nobody either.
      await call('PATCH', `/api/tickets/${id}`, a.cookie, { subject: 'Iný predmet' });
      expect(await assigneeIds(id, a.cookie)).toEqual([b.id]);
    });

    it('a ticket without a client that gets one takes the new client table', async () => {
      const g = await group();
      const [a, b] = [await admin(), await admin()];
      await setRules(g.id, a.cookie, [{ area: 'Projekty', userId: b.id }]);
      const { id } = (await intake(null, 'Projekty')).json<{ id: string }>();
      const moved = await call('PUT', `/api/tickets/${id}/group`, a.cookie, { groupId: g.id });
      expect(moved.statusCode).toBe(200);
      expect(moved.json<TicketDto>().assignees.map((p) => p.id)).toEqual([b.id]);
    });

    it('on creation the area admin joins an assignee already there, once', async () => {
      const g = await group();
      const [a, b] = [await admin(), await admin()];
      await setRules(g.id, a.cookie, [{ area: 'Projekty', userId: b.id }]);
      const { id } = (await intake(g.host, 'Projekty')).json<{ id: string }>();
      // A second, explicit assignment of the same admin changes nothing.
      await call('PUT', `/api/tickets/${id}/assignees/${b.id}`, a.cookie);
      await call('PUT', `/api/tickets/${id}/assignees/${a.id}`, a.cookie);
      expect(await assigneeIds(id, a.cookie)).toEqual([a.id, b.id].sort());
      expect((await eventsOf(id, [b.id])).filter((e) => e.kind === 'ticket.assigned')).toHaveLength(
        1,
      );
    });
  });

  describe('eGrant: PUT /api/egrant/ticket-areas', () => {
    it('without the key or with a wrong one is 401; with no key configured 503', async () => {
      const g = await group();
      const body = { instance_url: g.host, areas: [] };
      expect((await egrant(body, null)).statusCode).toBe(401);
      expect((await egrant(body, 'wrong-key-wrong-key-wrong')).statusCode).toBe(401);
      const off = await buildTestApp();
      try {
        expect((await egrant(body, KEY, off.app)).statusCode).toBe(503);
      } finally {
        await off.app.close();
        await off.close();
      }
    });

    it('takes the groups webhook own key when it is set', async () => {
      const own = 'test-egrant-groups-own-key-9876';
      const app = await buildTestApp({ config: { ticketsApiKey: KEY, egrantGroupsApiKey: own } });
      try {
        const g = await group();
        const body = { instance_url: g.host, areas: [] };
        expect((await egrant(body, KEY, app.app)).statusCode).toBe(401);
        expect((await egrant(body, own, app.app)).statusCode).toBe(200);
      } finally {
        await app.app.close();
        await app.close();
      }
    });

    it('with the groups signing secret set, needs a valid signature', async () => {
      const secret = 'groups-signing-secret-areas-0123456789';
      const signed = await buildTestApp({
        config: {
          ticketsApiKey: KEY,
          egrantSigningSecrets: { tickets: null, managers: null, groups: secret, projects: null },
        },
      });
      try {
        const g = await group();
        const body = JSON.stringify({ instance_url: g.host, areas: [] });
        const ts = Math.floor(Date.now() / 1000);
        const good = {
          'x-spolu-timestamp': String(ts),
          'x-spolu-signature': signEgrantRequest(secret, ts, body),
        };
        expect((await egrant(body, KEY, signed.app)).statusCode).toBe(401);
        expect(
          (
            await egrant(body, KEY, signed.app, {
              ...good,
              'x-spolu-signature': signEgrantRequest(secret, ts, '{}'),
            })
          ).statusCode,
        ).toBe(401);
        expect((await egrant(body, KEY, signed.app, good)).statusCode).toBe(200);
        expect((await egrant(body, KEY, signed.app, good)).statusCode).toBe(401);
      } finally {
        await signed.app.close();
        await signed.close();
      }
    });

    it('an unknown instance is 404; a bad body 400 with the fields', async () => {
      const res = await egrant({ instance_url: host(), areas: [] });
      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: 'unknown_instance' });
      const bad = await egrant({
        instance_url: host(),
        areas: [{ area: 'A', email: 'nope' }],
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ error: 'validation_failed', fields: ['areas[0].email'] });
      const many = Array.from({ length: 201 }, () => ({ area: 'A', email: 'a@b.sk' }));
      expect((await egrant({ instance_url: host(), areas: many })).statusCode).toBe(400);
      expect(
        (
          await egrant({
            instance_url: host(),
            areas: [{ area: 'x'.repeat(201), email: 'a@b.sk' }],
          })
        ).statusCode,
      ).toBe(400);
    });

    it('replaces the whole table, matches emails in any case, skips unknown ones', async () => {
      const g = await group('Mesto eGrant');
      const anna = await admin('Anna');
      const boris = await admin('Boris');
      const gone = await admin('Gone');
      await deactivateUser(db(), gone.id);
      const client = await member(g.id, 'client');
      // A manual row, replaced by the sync.
      await setRules(g.id, anna.cookie, [{ area: 'Ručne', userId: anna.id }]);

      const res = await egrant({
        instance_url: `https://www.${g.host}/admin/x`,
        areas: [
          { area: 'zend.Projekty', email: boris.email.toUpperCase() },
          { area: 'Platby', email: anna.email },
          { area: 'Platby', email: 'nobody@example.com' },
          { area: 'Iné', email: gone.email },
          { area: 'Klient', email: client.email },
        ],
      });
      expect(res.statusCode).toBe(200);
      const answer = res.json<EgrantTicketAreasResponse>();
      expect(answer).toEqual({
        state: 'updated',
        group_id: g.id,
        rules: [
          { area: 'zend.Projekty', email: boris.email },
          { area: 'Platby', email: anna.email },
        ],
        unmatched: [
          { area: 'Platby', email: 'nobody@example.com' },
          { area: 'Iné', email: gone.email },
          { area: 'Klient', email: client.email },
        ],
      });
      // Never a new user.
      const made = await db().select().from(user).where(eq(user.email, 'nobody@example.com'));
      expect(made).toEqual([]);
      const table = (
        await call('GET', `/api/groups/${g.id}/ticket-areas`, anna.cookie)
      ).json<TicketAreaRules>();
      expect(table.rules.map((r) => [r.area, r.user.id])).toEqual([
        ['zend.Projekty', boris.id],
        ['Platby', anna.id],
      ]);

      // Idempotent: the same list again is `unchanged` and writes no audit row.
      const again = await egrant({
        instance_url: g.host,
        areas: [
          { area: 'zend.Projekty', email: boris.email },
          { area: 'Platby', email: anna.email },
          { area: 'Platby', email: 'nobody@example.com' },
        ],
      });
      expect(again.json<EgrantTicketAreasResponse>().state).toBe('unchanged');
      const rows = (await auditRowsOf(db(), g.id)).filter(
        (r) => r.entityType === 'ticket_area_rules',
      );
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        actorKind: 'egrant',
        actorDetail: 'ticket_areas',
        actorLabel: `https://${g.host}`,
      });

      // The synced table drives new tickets.
      const { id } = (await intake(g.host, 'projekty')).json<{ id: string }>();
      expect(await assigneeIds(id, anna.cookie)).toEqual([boris.id]);

      // An empty list empties the table.
      const cleared = await egrant({ instance_url: g.host, areas: [] });
      expect(cleared.json<EgrantTicketAreasResponse>()).toMatchObject({
        state: 'updated',
        rules: [],
        unmatched: [],
      });
    });
  });
});
