import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { KnowledgeItemDto, ReminderSetDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { reminderTimes } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Person = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

describe('reminders API (knowledge subjects)', () => {
  let test: TestApp;

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  async function newAdmin(): Promise<Person> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: 'Rem Admin' });
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string): Promise<Person> {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Rem Client', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  const newGroup = () =>
    createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });

  async function reminderItem(
    cookie: string,
    groupId: string,
    over: { title?: string; times?: string[]; visibility?: string } = {},
  ) {
    const res = await call('POST', `/api/groups/${groupId}/knowledge`, cookie, {
      type: 'reminder',
      title: over.title ?? 'Call the bank',
      body: 'Ask about the loan',
      visibility: over.visibility ?? 'public',
      reminder: { times: (over.times ?? [inHours(2)]).map((at) => ({ at })), recipientIds: [] },
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<KnowledgeItemDto>();
  }

  const reminders = (id: string) => `/api/knowledge/${id}/reminders`;
  const setOf = async (id: string, cookie: string) =>
    (await call('GET', reminders(id), cookie)).json<ReminderSetDto>();

  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it('401 without a session', async () => {
    const id = randomUUID();
    for (const [method, url] of [
      ['GET', reminders(id)],
      ['POST', `${reminders(id)}/subscription`],
      ['DELETE', `${reminders(id)}/subscription`],
      ['GET', `${reminders(id)}/calendar.ics`],
    ] as const) {
      expect((await call(method, url)).statusCode).toBe(401);
    }
  });

  it('subscribe then unsubscribe answers 204 and changes subscribed', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const item = await reminderItem(admin.cookie, g.id);
    expect((await setOf(item.id, client.cookie)).subscribed).toBe(false);

    const sub = await call('POST', `${reminders(item.id)}/subscription`, client.cookie);
    expect(sub.statusCode).toBe(204);
    expect(sub.body).toBe('');
    const after = await setOf(item.id, client.cookie);
    expect(after.subscribed).toBe(true);
    expect(after.recipients).toContainEqual({
      user: { id: client.id, name: 'Rem Client' },
      source: 'subscribed',
    });
    // Subscribing again changes nothing.
    expect(
      (await call('POST', `${reminders(item.id)}/subscription`, client.cookie)).statusCode,
    ).toBe(204);

    const unsub = await call('DELETE', `${reminders(item.id)}/subscription`, client.cookie);
    expect(unsub.statusCode).toBe(204);
    expect((await setOf(item.id, client.cookie)).subscribed).toBe(false);
  });

  it("the author's unsubscribe is 400 author_recipient", async () => {
    const g = await newGroup();
    const client = await clientIn(g.id);
    const item = await reminderItem(client.cookie, g.id);
    const res = await call('DELETE', `${reminders(item.id)}/subscription`, client.cookie);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'author_recipient' });
    expect((await setOf(item.id, client.cookie)).subscribed).toBe(true);
  });

  it('an item without a reminder set is 404 no_reminder_set on subscription changes', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const res = await call('POST', `/api/groups/${g.id}/knowledge`, admin.cookie, {
      type: 'note',
      title: 'Plain',
    });
    const id = res.json<KnowledgeItemDto>().id;
    for (const method of ['POST', 'DELETE'] as const) {
      const sub = await call(method, `${reminders(id)}/subscription`, admin.cookie);
      expect(sub.statusCode).toBe(404);
      expect(sub.json()).toEqual({ error: 'no_reminder_set' });
    }
    // Reading a readable subject's reminders answers the empty set (Phase 19).
    const read = await call('GET', reminders(id), admin.cookie);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ times: [], recipients: [], subscribed: false, canEdit: true });
    expect((await call('GET', `${reminders(id)}/calendar.ics`, admin.cookie)).statusCode).toBe(404);
  });

  it('an unknown item and a foreign group are 404 not_found on every route', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const other = await newGroup();
    const outsider = await clientIn(other.id);
    const item = await reminderItem(admin.cookie, g.id);
    for (const [id, cookie] of [
      [randomUUID(), admin.cookie],
      [item.id, outsider.cookie],
    ] as const) {
      for (const [method, url] of [
        ['GET', reminders(id)],
        ['POST', `${reminders(id)}/subscription`],
        ['DELETE', `${reminders(id)}/subscription`],
        ['GET', `${reminders(id)}/calendar.ics`],
      ] as const) {
        const res = await call(method, url, cookie);
        expect(res.statusCode, `${method} ${url}`).toBe(404);
        expect(res.json()).toEqual({ error: 'not_found' });
      }
    }
  });

  it('calendar.ics has the headers and one VEVENT per upcoming time', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const client = await clientIn(g.id);
    const item = await reminderItem(admin.cookie, g.id, {
      title: 'Pay the VAT!',
      times: [inHours(2), inHours(26), inHours(50)],
    });
    // One time has fired: it is no longer upcoming.
    const set = await setOf(item.id, admin.cookie);
    await test.deps.db
      .update(reminderTimes)
      .set({ firedAt: new Date() })
      .where(eq(reminderTimes.id, set.times[0]!.id));

    const res = await call('GET', `${reminders(item.id)}/calendar.ics`, client.cookie);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/calendar; charset=utf-8');
    expect(res.headers['content-disposition']).toBe('attachment; filename="pay-the-vat.ics"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(res.body).toContain(`UID:reminder-${set.times[1]!.id}@spolu`);
    expect(res.body).not.toContain(`UID:reminder-${set.times[0]!.id}@spolu`);
    expect(res.body).toContain('SUMMARY:Pay the VAT!');
  });

  it('PUT on a knowledge item is 404 (its times are edited with the item)', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const item = await reminderItem(admin.cookie, g.id);
    const res = await call('PUT', reminders(item.id), admin.cookie, { times: [] });
    expect(res.statusCode).toBe(404);
    expect((await setOf(item.id, admin.cookie)).times).toHaveLength(1);
  });

  it('no upcoming time is 404', async () => {
    const admin = await newAdmin();
    const g = await newGroup();
    const item = await reminderItem(admin.cookie, g.id);
    const set = await setOf(item.id, admin.cookie);
    await test.deps.db
      .update(reminderTimes)
      .set({ firedAt: new Date() })
      .where(eq(reminderTimes.id, set.times[0]!.id));
    const res = await call('GET', `${reminders(item.id)}/calendar.ics`, admin.cookie);
    expect(res.statusCode).toBe(404);
  });

  it('subscription changes over 120/min answer 429', async () => {
    const admin = await newAdmin();
    const id = randomUUID();
    for (let i = 0; i < 120; i++) {
      expect((await call('POST', `${reminders(id)}/subscription`, admin.cookie)).statusCode).toBe(
        404,
      );
    }
    const res = await call('DELETE', `${reminders(id)}/subscription`, admin.cookie);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
    expect((await call('GET', reminders(id), admin.cookie)).statusCode).toBe(404);
  });
});
