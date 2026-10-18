import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditPageSchema } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { systemActor } from './actor.js';
import { recordAudit } from './service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('GET /api/audit', () => {
  let test: TestApp;
  let adminCookie: string;
  let adminId: string;
  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    adminId = (await addAdmin(test.deps.db, { email, name: 'Ada' })).id;
    adminCookie = await loginAs(test.app, email);
  });
  afterAll(async () => {
    await deactivateUser(test.deps.db, adminId);
    await test.app.close();
    await test.close();
  });

  const get = (url: string, cookie?: string) =>
    test.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

  it('401 without a session', async () => {
    expect((await get('/api/audit')).statusCode).toBe(401);
  });

  it('403 for a client and a requester', async () => {
    const group = await createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    for (const role of ['client', 'ziadatel'] as const) {
      const email = `${randomUUID()}@example.com`;
      const person = await createUnverifiedClient(test.deps.db, email, 'Klient');
      await addMembership(test.deps.db, person.id, group.id, role);
      const res = await get('/api/audit', await loginAs(test.app, email));
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'forbidden' });
    }
  });

  it.each([
    ['entityId without entityType', '?entityId=x'],
    ['from after to', '?from=2026-10-20&to=2026-10-19'],
    ['a bad cursor', '?cursor=bm9wZQ'],
    ['an unknown actor', '?actor=kind:nobody'],
    ['a limit over 100', '?limit=500'],
  ])('400 invalid_filter for %s', async (_name, query) => {
    const res = await get(`/api/audit${query}`, adminCookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_filter' });
  });

  it('200 with the page shape', async () => {
    const entityId = randomUUID();
    await recordAudit(test.deps.db, systemActor('t'), [
      { entityType: 'task', entityId, entityLabel: 'T', groupId: null, action: 'created' },
    ]);
    const res = await get(`/api/audit?entityType=task&entityId=${entityId}`, adminCookie);
    expect(res.statusCode).toBe(200);
    const page = AuditPageSchema.parse(res.json());
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      entityId,
      action: 'created',
      actor: { kind: 'system', job: 't' },
    });
    expect(page.nextCursor).toBeNull();
  });
});
