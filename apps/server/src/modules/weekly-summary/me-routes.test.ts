import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { deactivateUser } from '../users/service.js';
import { currentRecipients } from './recipients.js';
import { weeklySummaryGroupSettings } from './schema.js';
import { makeAdmin, makeClient, makeGroup } from './test-fixtures.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('a person’s own weekly summary settings', () => {
  let test: TestApp;
  const admins: string[] = [];
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });
  const db = () => test.deps.db;
  const call = (method: 'GET' | 'PUT', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  it('a client lists their groups with subscribed true by default', async () => {
    const a = await makeGroup(db(), 'A firma');
    const b = await makeGroup(db(), 'B firma');
    const client = await makeClient(db(), a.id);
    const { addMembership } = await import('../groups/memberships.js');
    await addMembership(db(), client.id, b.id, 'client');
    await db().insert(weeklySummaryGroupSettings).values({ groupId: b.id, enabled: false });
    const cookie = await loginAs(test.app, client.email);
    const res = await call('GET', '/api/me/weekly-summary', cookie);
    expect(res.json()).toEqual({
      groups: [
        { groupId: a.id, name: 'A firma', subscribed: true, enabled: true },
        { groupId: b.id, name: 'B firma', subscribed: true, enabled: false },
      ],
    });
  });

  it('a client unsubscribes from one group and is no recipient of it any more', async () => {
    const g = await makeGroup(db());
    const client = await makeClient(db(), g.id);
    const cookie = await loginAs(test.app, client.email);
    const res = await call('PUT', `/api/me/weekly-summary/${g.id}`, cookie, { subscribed: false });
    expect(res.json()).toEqual({ subscribed: false });
    expect(await currentRecipients(db(), g.id)).toEqual([]);
    await call('PUT', `/api/me/weekly-summary/${g.id}`, cookie, { subscribed: true });
    expect(await currentRecipients(db(), g.id)).toHaveLength(1);
  });

  it('a group the client is not in answers 404; an admin gets 403', async () => {
    const g = await makeGroup(db());
    const other = await makeGroup(db());
    const client = await makeClient(db(), g.id);
    const cookie = await loginAs(test.app, client.email);
    const res = await call('PUT', `/api/me/weekly-summary/${other.id}`, cookie, {
      subscribed: false,
    });
    expect(res.statusCode).toBe(404);
    const admin = await makeAdmin(db());
    admins.push(admin.id);
    const adminCookie = await loginAs(test.app, admin.email);
    const forbidden = await call('PUT', `/api/me/weekly-summary/${g.id}`, adminCookie, {
      subscribed: false,
    });
    expect(forbidden.statusCode).toBe(403);
  });

  it('an admin turns the reminder off; a client cannot', async () => {
    const admin = await makeAdmin(db());
    admins.push(admin.id);
    const cookie = await loginAs(test.app, admin.email);
    expect((await call('GET', '/api/me/weekly-summary/reminder', cookie)).json()).toEqual({
      remind: true,
    });
    await call('PUT', '/api/me/weekly-summary/reminder', cookie, { remind: false });
    expect((await call('GET', '/api/me/weekly-summary/reminder', cookie)).json()).toEqual({
      remind: false,
    });
    const g = await makeGroup(db());
    const client = await makeClient(db(), g.id);
    const clientCookie = await loginAs(test.app, client.email);
    expect((await call('GET', '/api/me/weekly-summary/reminder', clientCookie)).statusCode).toBe(
      403,
    );
  });
});
