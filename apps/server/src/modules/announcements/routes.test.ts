import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CurrentAnnouncement } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFakeProvider } from '../ai/fake-provider.js';
import { createGroup } from '../groups/service.js';
import { addMembership } from '../groups/memberships.js';
import { addAdmin, createUnverifiedClient, setFinanceAccess } from '../users/service.js';
import { ANNOUNCEMENTS } from './catalogue.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const CURRENT = ANNOUNCEMENTS[0]!.id;

describe('announcements API ("What\'s new")', () => {
  let test: TestApp;
  let noAi: TestApp;
  beforeAll(async () => {
    test = await buildTestApp({ ai: createFakeProvider() });
    noAi = await buildTestApp();
  });
  afterAll(async () => {
    for (const t of [test, noAi]) {
      await t.app.close();
      await t.close();
    }
  });

  const get = (t: TestApp, cookie: string) =>
    t.app.inject({ method: 'GET', url: '/api/me/announcement', headers: { cookie } });
  const seen = (t: TestApp, cookie: string, id: string) =>
    t.app.inject({ method: 'POST', url: `/api/me/announcement/${id}/seen`, headers: { cookie } });
  const sections = async (t: TestApp, cookie: string) =>
    (await get(t, cookie)).json<CurrentAnnouncement>().announcement?.sections ?? null;

  async function admin(t = test) {
    const email = `${randomUUID()}@example.com`;
    const a = await addAdmin(t.deps.db, { email, name: 'Ada' });
    return { ...a, cookie: await loginAs(t.app, email) };
  }
  async function member(role: 'client' | 'ziadatel', t = test) {
    const group = await createGroup(t.deps.db, {
      name: 'Firma',
      egrantUrl: `https://s${randomUUID().replaceAll('-', '').slice(0, 20)}.egrant.sk`,
    });
    const c = await createUnverifiedClient(t.deps.db, `${randomUUID()}@example.com`, 'Klient');
    await addMembership(t.deps.db, c.id, group.id, role);
    return { ...c, cookie: await loginAs(t.app, c.email) };
  }

  it('an admin without the finance right gets every section but finance', async () => {
    const a = await admin();
    const res = await get(test, a.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.json<CurrentAnnouncement>()).toEqual({
      announcement: { id: CURRENT, sections: ['taskSplit', 'snippets', 'bulkEmail'] },
    });
  });

  it('the finance section shows only with the finance right', async () => {
    const a = await admin();
    const superadmin = await addAdmin(test.deps.db, {
      email: `${randomUUID()}@example.com`,
      name: 'Boss',
    });
    await setFinanceAccess(test.deps.db, a.id, superadmin.id);
    const cookie = await loginAs(test.app, a.email);
    expect(await sections(test, cookie)).toEqual(['taskSplit', 'snippets', 'bulkEmail', 'finance']);
  });

  it('a client gets only the task generation', async () => {
    const c = await member('client');
    expect(await sections(test, c.cookie)).toEqual(['taskSplit']);
  });

  it('nothing is shown when no section applies (a ziadatel; a client while the AI is off)', async () => {
    const z = await member('ziadatel');
    expect((await get(test, z.cookie)).json()).toEqual({ announcement: null });
    const c = await member('client', noAi);
    expect((await get(noAi, c.cookie)).json()).toEqual({ announcement: null });
    // An admin on a server without AI still gets the rest.
    const a = await admin(noAi);
    expect(await sections(noAi, a.cookie)).toEqual(['snippets', 'bulkEmail']);
  });

  it('once seen it never comes back, for that person only', async () => {
    const a = await admin();
    const b = await admin();
    const res = await seen(test, a.cookie, CURRENT);
    expect(res.statusCode).toBe(204);
    expect((await get(test, a.cookie)).json()).toEqual({ announcement: null });
    // Another login (another device) of the same person: still seen.
    const again = await loginAs(test.app, a.email);
    expect((await get(test, again)).json()).toEqual({ announcement: null });
    // A repeat is fine.
    expect((await seen(test, a.cookie, CURRENT)).statusCode).toBe(204);
    expect(await sections(test, b.cookie)).not.toBeNull();
  });

  it('WHATS_NEW=off answers no announcement (the e2e server)', async () => {
    const off = await buildTestApp({ config: { whatsNew: false } });
    try {
      const a = await admin(off);
      expect((await get(off, a.cookie)).json()).toEqual({ announcement: null });
    } finally {
      await off.app.close();
      await off.close();
    }
  });

  it('an unknown announcement is 404; signed out is 401', async () => {
    const a = await admin();
    expect((await seen(test, a.cookie, 'nope')).statusCode).toBe(404);
    expect((await test.app.inject({ method: 'GET', url: '/api/me/announcement' })).statusCode).toBe(
      401,
    );
    expect(
      (await test.app.inject({ method: 'POST', url: `/api/me/announcement/${CURRENT}/seen` }))
        .statusCode,
    ).toBe(401);
  });
});
