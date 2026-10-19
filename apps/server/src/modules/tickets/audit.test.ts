import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser } from '../users/service.js';

const KEY = 'test-tickets-audit-key-0123456';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const host = () => `t${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('tickets: audit rows', () => {
  let test: TestApp;
  let admin: { id: string; cookie: string };
  let ip = 0;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email, name: 'Jana Nováková' });
    admins.push(row.id);
    admin = { id: row.id, cookie: await loginAs(test.app, email) };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: object) =>
    test.app.inject({
      method,
      url,
      headers: { cookie: admin.cookie },
      ...(payload ? { payload } : {}),
    });
  const intake = (payload: object) =>
    test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      remoteAddress: `10.7.0.${++ip % 250}`,
      headers: { authorization: `Bearer ${KEY}` },
      payload,
    });
  const newGroup = async () => {
    const h = host();
    const g = await createGroup(db(), {
      name: 'Mesto Senica',
      egrantUrl: `https://${h}.egrant.sk`,
    });
    return { ...g, url: `https://${h}.egrant.sk` };
  };
  const manual = async (groupId: string, body: object = {}) => {
    const res = await call('POST', '/api/tickets', {
      groupId,
      subject: 'Nefunguje prihlásenie',
      ...body,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<{ id: string; number: number }>();
  };

  it('the intake records an egrant row with the instance; a duplicate records nothing', async () => {
    const g = await newGroup();
    const requestId = randomUUID();
    const body = {
      subject: 'Chyba v rozpočte',
      body: 'Tajný text tiketu 3k',
      email: `${randomUUID()}@example.com`,
      instance_url: g.url,
      request_id: requestId,
    };
    const first = await intake(body);
    expect(first.statusCode, first.body).toBe(201);
    const id = first.json<{ id: string }>().id;
    expect((await intake(body)).statusCode).toBe(200);
    const rows = await auditRowsOf(db(), id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'ticket',
      action: 'created',
      actorKind: 'egrant',
      actorDetail: 'intake',
      actorLabel: g.url,
      groupId: g.id,
      changes: {
        subject: { to: 'Chyba v rozpočte' },
        body: { changed: true },
        status: { to: 'new' },
      },
    });
    expect(JSON.stringify(rows)).not.toContain('Tajný text');
  });

  it("an admin's status change records status from and to; the text is never in the row", async () => {
    const g = await newGroup();
    const t = await manual(g.id);
    expect(
      (await call('PATCH', `/api/tickets/${t.id}`, { status: 'in_progress' })).statusCode,
    ).toBe(200);
    expect(
      (await call('PATCH', `/api/tickets/${t.id}`, { body: 'Nový tajný popis 9z' })).statusCode,
    ).toBe(200);
    const rows = await auditRowsOf(db(), t.id);
    expect(rows.map((r) => [r.action, r.actorUserId])).toEqual([
      ['created', admin.id],
      ['updated', admin.id],
      ['updated', admin.id],
    ]);
    expect(rows[1]!.changes).toEqual({ status: { from: 'new', to: 'in_progress' } });
    expect(rows[2]!.changes).toEqual({ body: { changed: true } });
    expect(rows[0]!.entityLabel).toBe(`#${t.number} Nefunguje prihlásenie`);
    expect(JSON.stringify(rows)).not.toContain('Nový tajný popis');
  });

  it('moving a ticket to a client records client from and to', async () => {
    const intakeRes = await intake({
      subject: 'Bez klienta',
      email: `${randomUUID()}@example.com`,
    });
    const id = intakeRes.json<{ id: string }>().id;
    const g = await newGroup();
    expect((await call('PUT', `/api/tickets/${id}/group`, { groupId: g.id })).statusCode).toBe(200);
    const rows = await auditRowsOf(db(), id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'updated']);
    expect(rows[1]).toMatchObject({
      groupId: g.id,
      actorUserId: admin.id,
      changes: { client: { from: null, to: { id: g.id, label: 'Mesto Senica' } } },
    });
  });

  it('adding and removing a riešiteľ record assignee rows with the person', async () => {
    const g = await newGroup();
    const t = await manual(g.id);
    expect((await call('PUT', `/api/tickets/${t.id}/assignees/${admin.id}`)).statusCode).toBe(200);
    expect((await call('PUT', `/api/tickets/${t.id}/assignees/${admin.id}`)).statusCode).toBe(200);
    expect((await call('DELETE', `/api/tickets/${t.id}/assignees/${admin.id}`)).statusCode).toBe(
      200,
    );
    const rows = await auditRowsOf(db(), t.id);
    const person = { id: admin.id, label: 'Jana Nováková' };
    expect(rows.slice(1).map((r) => [r.action, r.changes])).toEqual([
      ['assignee_added', { assignees: { added: [person], removed: [] } }],
      ['assignee_removed', { assignees: { added: [], removed: [person] } }],
    ]);
  });
});
