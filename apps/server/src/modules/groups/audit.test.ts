import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { memberEntityId } from './audit.js';
import { setPendingInvite } from './memberships.js';
import { createGroup, getGroup } from './service.js';

const KEY = 'test-egrant-audit-key-0123456';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const host = () => `a${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`;

describe('groups: audit rows', () => {
  let test: TestApp;
  let admin: { id: string; name: string; cookie: string };
  let ip = 0;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email, name: 'Jana Nováková' });
    admins.push(row.id);
    admin = { id: row.id, name: row.name, cookie: await loginAs(test.app, email) };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (method: 'POST' | 'PATCH' | 'PUT' | 'DELETE', url: string, payload?: object) =>
    test.app.inject({
      method,
      url,
      headers: { cookie: admin.cookie },
      ...(payload ? { payload } : {}),
    });
  const hook = (url: string, payload: object) =>
    test.app.inject({
      method: 'PUT',
      url,
      remoteAddress: `10.9.0.${++ip % 250}`,
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      payload,
    });
  const newGroup = async () => {
    const url = `https://${host()}`;
    const res = await call('POST', '/api/groups', { name: 'Mesto Senica', egrantUrl: url });
    expect(res.statusCode).toBe(201);
    return { ...res.json<{ id: string }>(), url };
  };
  const byAdmin = () => ({ actorKind: 'user', actorUserId: admin.id, actorLabel: 'Jana Nováková' });

  it('creating a group records group.created with name and eGrant URL', async () => {
    const g = await newGroup();
    const rows = await auditRowsOf(db(), g.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      ...byAdmin(),
      entityType: 'group',
      action: 'created',
      entityLabel: 'Mesto Senica',
      groupId: g.id,
      category: 'general',
      changes: { name: { to: 'Mesto Senica' }, egrantUrl: { to: g.url } },
    });
  });

  it('renaming records group.updated with name from and to; an unchanged PATCH records nothing', async () => {
    const g = await newGroup();
    expect(
      (await call('PATCH', `/api/groups/${g.id}`, { name: 'Mesto Senica', egrantUrl: g.url }))
        .statusCode,
    ).toBe(200);
    expect(await auditRowsOf(db(), g.id)).toHaveLength(1);
    await call('PATCH', `/api/groups/${g.id}`, { name: 'Senica', egrantUrl: g.url });
    const rows = await auditRowsOf(db(), g.id);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toMatchObject({
      action: 'updated',
      entityLabel: 'Senica',
      changes: { name: { from: 'Mesto Senica', to: 'Senica' } },
    });
  });

  it('regenerating the invite records invite_regenerated without the token', async () => {
    const g = await newGroup();
    const res = await call('POST', `/api/groups/${g.id}/invite`);
    expect(res.statusCode).toBe(200);
    const token = (await getGroup(db(), g.id))!.inviteToken;
    const rows = await auditRowsOf(db(), g.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'invite_regenerated']);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('deactivate and reactivate record one row each; a repeat records nothing', async () => {
    const g = await newGroup();
    await call('POST', `/api/groups/${g.id}/deactivate`);
    await call('POST', `/api/groups/${g.id}/deactivate`);
    await call('POST', `/api/groups/${g.id}/reactivate`);
    await call('POST', `/api/groups/${g.id}/reactivate`);
    const rows = await auditRowsOf(db(), g.id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'deactivated', 'reactivated']);
  });

  it('adding a member by email records membership.invited with the email as label; remove, restore and cancel record one row each', async () => {
    const g = await newGroup();
    const email = `${randomUUID()}@example.com`;
    const res = await call('POST', `/api/groups/${g.id}/members`, { email });
    expect(res.statusCode).toBe(201);
    const userId = res.json<{ member: { id: string } }>().member.id;
    const id = memberEntityId(g.id, userId);
    expect((await auditRowsOf(db(), id))[0]).toMatchObject({
      ...byAdmin(),
      entityType: 'membership',
      action: 'invited',
      entityLabel: email,
      groupId: g.id,
      changes: { role: { to: 'client' } },
    });
    expect((await call('DELETE', `/api/groups/${g.id}/members/invited/${userId}`)).statusCode).toBe(
      204,
    );
    expect((await auditRowsOf(db(), id)).map((r) => r.action)).toEqual([
      'invited',
      'invite_cancelled',
    ]);

    // A second member, kept, so removing one is not their last group.
    const other = await createUnverifiedClient(db(), `${randomUUID()}@example.com`, 'Peter Kováč');
    const keep = await createGroup(db(), { name: 'Iná', egrantUrl: `https://${host()}` });
    await call('POST', `/api/groups/${keep.id}/members`, { email: other.email });
    await call('POST', `/api/groups/${g.id}/members`, { email: other.email });
    expect((await call('DELETE', `/api/groups/${g.id}/members/${other.id}`)).statusCode).toBe(204);
    await call('DELETE', `/api/groups/${g.id}/members/${other.id}`);
    expect((await call('POST', `/api/groups/${g.id}/members/${other.id}/restore`)).statusCode).toBe(
      204,
    );
    const actions = (await auditRowsOf(db(), memberEntityId(g.id, other.id))).map((r) => r.action);
    expect(actions).toEqual(['invited', 'removed', 'restored']);
  });

  it('joining with an invite link records membership.added by the joining person', async () => {
    const g = await newGroup();
    const email = `${randomUUID()}@example.com`;
    const client = await createUnverifiedClient(db(), email, 'Klientka');
    await setPendingInvite(db(), client.id, g.id);
    await loginAs(test.app, email); // signing in applies the pending invite
    const rows = await auditRowsOf(db(), memberEntityId(g.id, client.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: 'user',
      actorUserId: client.id,
      action: 'added',
      entityLabel: 'Klientka',
    });
  });

  it('addManager twice records one manager.added; removeManager records manager.removed', async () => {
    const g = await newGroup();
    const other = await addAdmin(db(), { email: `${randomUUID()}@example.com`, name: 'Eva Admin' });
    admins.push(other.id);
    await call('PUT', `/api/groups/${g.id}/managers/${other.id}`);
    await call('PUT', `/api/groups/${g.id}/managers/${other.id}`);
    await call('DELETE', `/api/groups/${g.id}/managers/${other.id}`);
    const rows = await auditRowsOf(db(), memberEntityId(g.id, other.id));
    expect(rows.map((r) => [r.entityType, r.action, r.entityLabel])).toEqual([
      ['manager', 'added', 'Eva Admin'],
      ['manager', 'removed', 'Eva Admin'],
    ]);
  });

  it('the groups webhook records egrant rows with the instance origin; unchanged records nothing', async () => {
    const h = host();
    const created = await hook('/api/egrant/groups', {
      instance_url: `https://${h}`,
      name: 'Obec Lúka',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<{ group_id: string }>().group_id;
    await hook('/api/egrant/groups', { instance_url: `https://${h}`, name: 'Obec Lúka' });
    await hook('/api/egrant/groups', { instance_url: `https://${h}`, name: 'Obec Lúka 2' });
    await hook('/api/egrant/groups', {
      instance_url: `https://${h}`,
      name: 'Obec Lúka 2',
      active: false,
    });
    const rows = await auditRowsOf(db(), id);
    expect(rows.map((r) => r.action)).toEqual(['created', 'updated', 'deactivated']);
    for (const row of rows) {
      expect(row).toMatchObject({
        actorKind: 'egrant',
        actorUserId: null,
        actorLabel: `https://${h}`,
        actorDetail: 'groups',
      });
    }
  });

  it('the managers webhook records membership.added and removed with actor egrant/managers', async () => {
    const g = await newGroup();
    const email = `${randomUUID()}@example.com`;
    const added = await hook('/api/egrant/managers', {
      instance_url: g.url,
      email,
      active: true,
      name: 'Ján',
    });
    expect(added.statusCode).toBeLessThan(300);
    await hook('/api/egrant/managers', { instance_url: g.url, email, active: false });
    const person = (
      await db().execute<{ id: string }>(
        // the account the webhook created
        sql`select id from "user" where email = ${email}`,
      )
    )[0]!;
    const rows = await auditRowsOf(db(), memberEntityId(g.id, person.id));
    expect(rows.map((r) => [r.action, r.actorKind, r.actorDetail, r.actorLabel])).toEqual([
      ['invited', 'egrant', 'managers', g.url],
      ['removed', 'egrant', 'managers', g.url],
    ]);
  });

  it('a failing write records nothing', async () => {
    const g = await newGroup();
    const res = await call('POST', '/api/groups', { name: 'Duplicate', egrantUrl: g.url });
    expect(res.statusCode).toBe(409);
    const rows = await db().execute<{ n: number }>(
      sql`select count(*)::int as n from audit_log
        where entity_type = 'group' and entity_label = 'Duplicate' and actor_user_id = ${admin.id}`,
    );
    expect(rows[0]!.n).toBe(0);
  });
});
