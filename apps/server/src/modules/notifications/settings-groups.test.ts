import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { NotificationGroupsPage } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { setTicketWatch } from '../tickets/watch.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** `GET /api/me/notification-groups`: the client table of `/settings/notifications` (X7). */
describe('notification settings: the client table', () => {
  let test: TestApp;
  const admins: string[] = [];
  const tag = randomUUID().slice(0, 8);
  const newGroup = (name: string) =>
    createGroup(test.deps.db, {
      name: `${name} ${tag}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
  const page = async (cookie: string, query = '') => {
    const res = await test.app.inject({
      method: 'GET',
      url: `/api/me/notification-groups${query}`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    return res.json<NotificationGroupsPage>();
  };

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('an admin sees the managed clients first, then the others by name, with the watch state', async () => {
    const email = `${randomUUID()}@example.com`;
    const admin = await addAdmin(test.deps.db, { email, name: 'Ada' });
    admins.push(admin.id);
    const cookie = await loginAs(test.app, email);
    const alfa = await newGroup('Alfa');
    const beta = await newGroup('Beta');
    const gama = await newGroup('Gama');
    await addManager(test.deps.db, gama.id, admin.id);
    await setTicketWatch(test.deps.db, admin.id, beta.id, true);

    const first = await page(cookie, `?q=${tag}`);
    expect(first.managed).toEqual([
      { id: gama.id, name: gama.name, kind: 'client', managed: true, watching: true },
    ]);
    expect(first.items).toEqual([
      { id: alfa.id, name: alfa.name, kind: 'client', managed: false, watching: false },
      { id: beta.id, name: beta.name, kind: 'client', managed: false, watching: true },
    ]);
    expect(first.nextCursor).toBeNull();

    // The search narrows both parts.
    const beta1 = await page(cookie, `?q=${encodeURIComponent(`Beta ${tag}`)}`);
    expect(beta1.managed).toEqual([]);
    expect(beta1.items.map((g) => g.id)).toEqual([beta.id]);
  });

  it('a client sees their own groups, watching new tickets by default', async () => {
    const group = await newGroup('Klient');
    const other = await newGroup('Cudzí');
    const id = randomUUID();
    const email = `${randomUUID()}@example.com`;
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'C', role: 'client', emailVerified: true });
    await addMembership(test.deps.db, id, group.id, 'client');
    const cookie = await loginAs(test.app, email);
    const result = await page(cookie);
    expect(result).toEqual({
      managed: [],
      items: [{ id: group.id, name: group.name, kind: 'client', managed: false, watching: true }],
      nextCursor: null,
    });
    expect(JSON.stringify(result)).not.toContain(other.id);
  });

  it('refuses a bad cursor', async () => {
    const email = `${randomUUID()}@example.com`;
    const admin = await addAdmin(test.deps.db, { email, name: 'Bo' });
    admins.push(admin.id);
    const res = await test.app.inject({
      method: 'GET',
      url: '/api/me/notification-groups?cursor=zzz',
      headers: { cookie: await loginAs(test.app, email) },
    });
    expect(res.statusCode).toBe(400);
  });
});
