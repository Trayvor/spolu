import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { FinanceItemDetail, ReminderSetDto, SessionUser } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { fireDueReminders } from '../reminders/jobs.js';
import { reminderSets, reminderTimes } from '../reminders/schema.js';
import { listUpcomingForUser } from '../reminders/service.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';

/**
 * A contract's reminders (part B, spec §2.3, decision 14): through the reminders module, kind
 * `finance`, recipients finance admins only, notifications in the `finance` group.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string; user: SessionUser };

const newEmail = () => `${randomUUID()}@example.com`;
const DAY = 24 * 60 * 60_000;

describe('finance reminders (part B)', () => {
  let test: TestApp;
  let fin: Session;
  let fin2: Session;
  let plain: Session;
  const admins: string[] = [];

  const call = (method: 'GET' | 'POST' | 'PUT', url: string, cookie: string, payload?: object) =>
    test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminSession(finance: boolean): Promise<Session> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: finance ? 'Fina' : 'Plain' });
    admins.push(admin.id);
    if (finance) await setFinanceAccess(test.deps.db, admin.id, admin.id);
    return {
      id: admin.id,
      cookie: await loginAs(test.app, email),
      user: { id: admin.id, email, name: 'x', role: 'admin', finance },
    };
  }

  async function contract(): Promise<FinanceItemDetail> {
    const g = await createGroup(test.deps.db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const res = await call('POST', `/api/groups/${g.id}/finance/items`, fin.cookie, {
      type: 'contract',
      title: `Zmluva ${randomUUID().slice(0, 6)}`,
      amount: { amountMinor: 1_200_000, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2027-12-31',
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FinanceItemDetail>();
  }
  const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();
  const put = (id: string, cookie: string, body: object) =>
    call('PUT', `/api/finance-items/${id}/reminders`, cookie, body);

  beforeAll(async () => {
    test = await buildTestApp();
    [fin, fin2, plain] = await Promise.all([
      adminSession(true),
      adminSession(true),
      adminSession(false),
    ]);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('a finance admin sets times and finance admins as recipients; nobody else can be added', async () => {
    const item = await contract();
    const ok = await put(item.id, fin.cookie, {
      times: [{ at: inDays(10) }],
      recipientIds: [fin2.id],
    });
    expect(ok.statusCode, ok.body).toBe(200);
    const set = ok.json<ReminderSetDto>();
    expect(set.recipients.map((r) => [r.user.id, r.source])).toEqual(
      expect.arrayContaining([
        [fin.id, 'author'],
        [fin2.id, 'added'],
      ]),
    );
    const bad = await put(item.id, fin.cookie, {
      times: set.times.map(({ id, at }) => ({ id, at })),
      baseTimeIds: set.times.map((t) => t.id),
      recipientIds: [fin2.id, plain.id],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: 'invalid_recipient' });

    // The row shows its bell.
    const detail = await call('GET', `/api/finance/items/${item.id}`, fin.cookie);
    expect(detail.json<FinanceItemDetail>().hasUpcomingReminder).toBe(true);
  });

  it('an admin without the right cannot read, set, subscribe to or export them', async () => {
    const item = await contract();
    await put(item.id, fin.cookie, { times: [{ at: inDays(5) }] });
    const base = `/api/finance-items/${item.id}/reminders`;
    expect((await call('GET', base, plain.cookie)).statusCode).toBe(404);
    expect((await put(item.id, plain.cookie, { times: [{ at: inDays(6) }] })).statusCode).toBe(404);
    expect((await call('POST', `${base}/subscription`, plain.cookie)).statusCode).toBe(404);
    expect((await call('GET', `${base}/calendar.ics`, plain.cookie)).statusCode).toBe(404);
    // A finance admin exports the calendar and subscribes.
    const ics = await call('GET', `${base}/calendar.ics`, fin2.cookie);
    expect(ics.statusCode).toBe(200);
    // The event links the item in the client's Finance tab (the line is folded at 75 octets).
    expect(ics.body.replace(/\r?\n /g, '')).toContain(
      `/groups/${item.groupId}/finance?item=${item.id}`,
    );
    expect((await call('POST', `${base}/subscription`, fin2.cookie)).statusCode).toBe(204);
  });

  it('the dashboard lists them to their finance recipients only', async () => {
    const item = await contract();
    await put(item.id, fin.cookie, { times: [{ at: inDays(1) }], recipientIds: [fin2.id] });
    const mine = await listUpcomingForUser(test.deps.db, fin2.user, { limit: 100 });
    expect(
      mine.find((r) => r.target.kind === 'finance' && r.target.itemId === item.id),
    ).toMatchObject({
      title: item.title,
      groupId: item.groupId,
    });
    const theirs = await listUpcomingForUser(test.deps.db, plain.user, { limit: 100 });
    expect(theirs.some((r) => r.target.kind === 'finance')).toBe(false);
  });

  it('fires to finance admins only, in the finance group, and skips one whose right was removed', async () => {
    const item = await contract();
    const res = await put(item.id, fin.cookie, {
      times: [{ at: inDays(1) }],
      recipientIds: [fin2.id],
    });
    expect(res.statusCode).toBe(200);
    const [set] = await test.deps.db
      .select({ id: reminderSets.id })
      .from(reminderSets)
      .where(eq(reminderSets.financeItemId, item.id));
    const [time] = await test.deps.db
      .update(reminderTimes)
      .set({ at: sql`now() - interval '1 minute'` })
      .where(eq(reminderTimes.setId, set!.id))
      .returning({ id: reminderTimes.id });
    // fin2 loses the right before the time comes.
    await setFinanceAccess(test.deps.db, fin2.id, null);
    await fireDueReminders(test.deps, { setIds: [set!.id] });
    const events = await test.deps.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.dedupeKey, `reminder:${time!.id}`));
    expect(events.map((e) => e.userId)).toEqual([fin.id]);
    expect(events[0]!.payload).toMatchObject({
      subjectKind: 'finance',
      subjectId: item.id,
      endsOn: '2027-12-31',
    });
    expect(JSON.stringify(events[0]!.payload)).not.toContain('1200000');
    await setFinanceAccess(test.deps.db, fin2.id, fin.id);
  });
});
