import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditPageSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { createGroup } from '../groups/service.js';
import { addManager } from '../groups/managers.js';
import { createToken } from '../mcp/tokens.js';
import {
  addAdmin,
  deactivateUser,
  ensureSuperadmin,
  findUserByEmail,
  setFinanceAccess,
} from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('admins and the finance right: audit rows', () => {
  let test: TestApp;
  let superCookie: string;
  let superId: string;
  let plain: { id: string; cookie: string };
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp();
    const email = 'admin@example.com'; // the test config's superadmin
    await ensureSuperadmin(test.deps.db, { email, name: 'admin' });
    superId = (await findUserByEmail(test.deps.db, email))!.id;
    superCookie = await loginAs(test.app, email);
    const plainEmail = `${randomUUID()}@example.com`;
    const row = await addAdmin(test.deps.db, { email: plainEmail, name: 'Bez financií' });
    admins.push(row.id);
    plain = { id: row.id, cookie: await loginAs(test.app, plainEmail) };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const call = (
    method: 'POST' | 'PUT' | 'DELETE' | 'GET',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  const newAdminViaApi = async (name: string) => {
    const res = await call('POST', '/api/admins', superCookie, {
      email: `${randomUUID()}@example.com`,
      name,
    });
    expect(res.statusCode).toBe(201);
    const id = res.json<{ id: string }>().id;
    admins.push(id);
    return id;
  };

  it('adding an admin records admin.added', async () => {
    const id = await newAdminViaApi('Peter Kováč');
    const rows = await auditRowsOf(test.deps.db, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'admin',
      action: 'added',
      entityLabel: 'Peter Kováč',
      actorUserId: superId,
      changes: { name: { to: 'Peter Kováč' } },
    });
  });

  it('granting the finance right twice records one finance_access.granted', async () => {
    const id = await newAdminViaApi('Finančník');
    expect((await call('PUT', `/api/admins/${id}/finance-access`, superCookie)).statusCode).toBe(
      204,
    );
    expect((await call('PUT', `/api/admins/${id}/finance-access`, superCookie)).statusCode).toBe(
      204,
    );
    const rows = (await auditRowsOf(test.deps.db, id)).filter(
      (r) => r.entityType === 'finance_access',
    );
    expect(rows.map((r) => [r.action, r.category])).toEqual([['granted', 'finance']]);
  });

  it('deactivating a finance admin records the deactivation and its consequences with cause_id', async () => {
    const id = await newAdminViaApi('Odchádzajúci');
    await setFinanceAccess(test.deps.db, id, superId);
    const token = await createToken(test.deps.db, id, {
      name: 'Claude Desktop',
      scope: 'write',
      expiresInDays: 7,
    });
    const group = await createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    await addManager(test.deps.db, group.id, id);
    expect((await call('DELETE', `/api/admins/${id}`, superCookie)).statusCode).toBe(204);
    const rows = await auditRowsOf(test.deps.db, id);
    const deactivation = rows.find((r) => r.action === 'deactivated')!;
    expect(deactivation).toMatchObject({
      entityType: 'admin',
      actorUserId: superId,
      causeId: null,
    });
    const right = rows.find((r) => r.entityType === 'finance_access')!;
    expect(right).toMatchObject({
      action: 'revoked',
      causeId: deactivation.id,
      category: 'finance',
    });
    const tokenRows = await auditRowsOf(test.deps.db, token.item.id);
    expect(tokenRows).toEqual([
      expect.objectContaining({
        entityType: 'mcp_token',
        action: 'revoked',
        causeId: deactivation.id,
      }),
    ]);
    // A token's value is never recorded.
    expect(JSON.stringify(tokenRows)).not.toContain(token.token);

    // The non-finance viewer sees the deactivation, not the revoked right.
    const page = AuditPageSchema.parse(
      (
        await call(
          'GET',
          `/api/audit?actor=user:${superId}&entityType=admin&entityId=${id}`,
          plain.cookie,
        )
      ).json(),
    );
    expect(page.items.map((i) => i.action)).toEqual(['deactivated', 'added']);
    const all = AuditPageSchema.parse(
      (await call('GET', `/api/audit?actor=user:${superId}&limit=100`, plain.cookie)).json(),
    );
    expect(all.items.some((i) => i.entityType === 'finance_access')).toBe(false);
    const finance = AuditPageSchema.parse(
      (
        await call('GET', `/api/audit?entityType=finance_access&entityId=${id}`, superCookie)
      ).json(),
    );
    expect(finance.items[0]?.cause).toMatchObject({ id: deactivation.id, action: 'deactivated' });
  });
});
