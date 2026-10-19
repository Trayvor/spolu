import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { AdminListSchema, GroupPersonListSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addAdmin } from '../users/service.js';
import { user } from '../users/schema.js';
import { addManager, isGroupManager } from './managers.js';
import { groupManagers } from './schema.js';
import { addMember, createGroup } from './service.js';
import { activeSubstitutions } from './substitutions.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
// Far enough ahead that the service tests' expiry runs never reach it.
const LATER = '2031-01-31';

describe('admin substitution API', () => {
  let test: TestApp;

  const call = (method: 'GET' | 'PUT' | 'DELETE', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function admin(name: string) {
    const email = newEmail();
    const row = await addAdmin(test.deps.db, { email, name });
    return { id: row.id, name, cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string) {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Klient', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () => createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it('sets, lists, labels and ends a substitution, with audit rows by the author', async () => {
    const g = await newGroup();
    const a = await admin('Anna Away');
    const b = await admin('Boris Backup');
    const c = await admin('Cyril Colleague');
    await addManager(test.deps.db, g.id, a.id);
    const client = await clientIn(g.id);

    const set = await call('PUT', `/api/admins/${a.id}/substitution`, c.cookie, {
      substituteId: b.id,
      endsOn: LATER,
    });
    expect(set.statusCode).toBe(201);
    const substitution = set.json<{ id: string }>();
    expect(substitution).toMatchObject({
      substitutedId: a.id,
      substituteId: b.id,
      substituteName: 'Boris Backup',
      endsOn: LATER,
    });

    const list = AdminListSchema.parse((await call('GET', '/api/admins', b.cookie)).json());
    expect(list.find((x) => x.id === a.id)?.substitution).toMatchObject({
      substituteId: b.id,
      endsOn: LATER,
    });
    expect(list.find((x) => x.id === b.id)?.substitution).toBeNull();

    // The client sees B among the managers, marked as A's substitute.
    const people = GroupPersonListSchema.parse(
      (await call('GET', `/api/groups/${g.id}/people`, client.cookie)).json(),
    );
    expect(people.find((p) => p.id === b.id)).toMatchObject({
      isManager: true,
      substitutesFor: 'Anna Away',
    });

    const end = await call('DELETE', `/api/admins/${a.id}/substitution`, c.cookie);
    expect(end.statusCode).toBe(204);
    expect(await isGroupManager(test.deps.db, g.id, b.id)).toBe(false);
    // Idempotent.
    expect((await call('DELETE', `/api/admins/${a.id}/substitution`, c.cookie)).statusCode).toBe(
      204,
    );

    const rows = await auditRowsOf(test.deps.db, substitution.id);
    expect(rows.map((r) => [r.entityType, r.action, r.actorUserId])).toEqual([
      ['substitution', 'started', c.id],
      ['substitution', 'ended', c.id],
    ]);
  });

  it('an admin may set it for themselves', async () => {
    const a = await admin('Self Setter');
    const b = await admin('Other');
    const res = await call('PUT', `/api/admins/${a.id}/substitution`, a.cookie, {
      substituteId: b.id,
      endsOn: null,
    });
    expect(res.statusCode).toBe(201);
    expect((await activeSubstitutions(test.deps.db)).get(a.id)?.endsOn).toBeNull();
  });

  it('answers the rule errors', async () => {
    const a = await admin('Rule A');
    const b = await admin('Rule B');
    const c = await admin('Rule C');
    const put = (target: string, body: object) =>
      call('PUT', `/api/admins/${target}/substitution`, c.cookie, body);

    expect((await put(a.id, { substituteId: a.id })).json()).toEqual({
      error: 'invalid_substitute',
    });
    expect((await put(a.id, { substituteId: randomUUID() })).statusCode).toBe(400);
    expect((await put(randomUUID(), { substituteId: b.id })).statusCode).toBe(404);
    expect((await put(a.id, { substituteId: b.id, endsOn: '2020-01-01' })).json()).toEqual({
      error: 'validation_failed',
    });
    expect((await put(a.id, { substituteId: b.id, endsOn: 'tomorrow' })).statusCode).toBe(400);
    expect((await put(a.id, {})).statusCode).toBe(400);

    expect((await put(a.id, { substituteId: b.id })).statusCode).toBe(201);
    const again = await put(a.id, { substituteId: c.id });
    expect([again.statusCode, again.json()]).toEqual([409, { error: 'already_substituted' }]);
    const chain = await put(c.id, { substituteId: a.id });
    expect([chain.statusCode, chain.json()]).toEqual([409, { error: 'substitute_away' }]);
  });

  it('is admins only', async () => {
    const g = await newGroup();
    const a = await admin('Client Target');
    const b = await admin('Client Sub');
    const client = await clientIn(g.id);
    expect(
      (
        await call('PUT', `/api/admins/${a.id}/substitution`, client.cookie, {
          substituteId: b.id,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/api/admins/${a.id}/substitution`, client.cookie)).statusCode,
    ).toBe(403);
    const anonymous = await test.app.inject({
      method: 'DELETE',
      url: `/api/admins/${a.id}/substitution`,
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it('does not hand over the finance right', async () => {
    const g = await newGroup();
    const a = await admin('Finance Anna');
    const b = await admin('No Finance Boris');
    await addManager(test.deps.db, g.id, a.id);
    expect(
      (
        await call('PUT', `/api/admins/${a.id}/substitution`, a.cookie, {
          substituteId: b.id,
        })
      ).statusCode,
    ).toBe(201);
    expect(await isGroupManager(test.deps.db, g.id, b.id)).toBe(true);
    const finance = await call('GET', `/api/groups/${g.id}/finance/items`, b.cookie);
    expect([403, 404]).toContain(finance.statusCode);
  });

  it("deactivating the substitute ends the substitution and B's derived rows", async () => {
    const g = await newGroup();
    const a = await admin('Deact A');
    const b = await admin('Deact B');
    const c = await admin('Deact C');
    await addManager(test.deps.db, g.id, a.id);
    await call('PUT', `/api/admins/${a.id}/substitution`, c.cookie, { substituteId: b.id });
    expect((await call('DELETE', `/api/admins/${b.id}`, c.cookie)).statusCode).toBe(204);
    expect((await activeSubstitutions(test.deps.db)).has(a.id)).toBe(false);
    const left = await test.deps.db
      .select()
      .from(groupManagers)
      .where(and(eq(groupManagers.groupId, g.id), eq(groupManagers.userId, b.id)));
    expect(left).toEqual([]);
    expect(await isGroupManager(test.deps.db, g.id, a.id)).toBe(true);
  });
});
