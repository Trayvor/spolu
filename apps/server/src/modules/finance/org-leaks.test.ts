import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { FinanceEvents, type FileInfo, type FinanceItemDetail } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { deliverPending } from '../notifications/deliver.js';
import { saveSubscription } from '../notifications/push-subscriptions.js';
import { notificationEvents } from '../notifications/schema.js';
import { fireDueReminders } from '../reminders/jobs.js';
import { reminderSets, reminderTimes } from '../reminders/schema.js';
import { user } from '../users/schema.js';
import {
  addAdmin,
  createRequesterAccount,
  deactivateUser,
  setFinanceAccess,
} from '../users/service.js';

/**
 * The leak guarantees of Phase 32 E (spec 2026-10-18, decisions O5, O6, E10): expenses and the
 * organisation's items, folders and files reach finance admins only. An admin without the right,
 * a client and a requester (žiadateľ) get 403 from every new route and nothing of them anywhere
 * else: not in the knowledge lists and search, not in a group room's events, not in a reminder's
 * notification (which a revoked finance admin no longer gets either, and which never carries an
 * amount). The other clients' shares never reach a client's tab (`org.test.ts`).
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;

describe('finance leak guarantees (Phase 32 E)', () => {
  let test: TestApp;
  let quiet: AppDeps;
  let url: string;
  let fin: Session;
  let fin2: Session;
  let plain: Session;
  let client: Session;
  let requester: Session;
  let groupId: string;
  let expense: FinanceItemDetail;
  let sharedContract: FinanceItemDetail;
  let orgFile: FileInfo;
  const word = `Mzdovy${randomUUID().slice(0, 8)}`;
  const admins: string[] = [];
  const sockets: Socket[] = [];

  const call = (method: string, path: string, cookie: string, payload?: object) =>
    test.app.inject({
      method: method as 'GET',
      url: path,
      headers: { cookie },
      ...(payload ? { payload } : {}),
    });

  async function adminSession(finance: boolean, name: string): Promise<Session> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name });
    admins.push(admin.id);
    if (finance) await setFinanceAccess(test.deps.db, admin.id, admin.id);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  const newGroup = () =>
    createGroup(test.deps.db, {
      name: `Obec ${randomUUID().slice(0, 6)}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
  async function connected(cookie: string): Promise<Socket> {
    const socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  beforeAll(async () => {
    test = await buildTestApp();
    quiet = { ...test.deps, jobs: { ...test.deps.jobs, send: async () => {} } };
    [fin, fin2, plain] = await Promise.all([
      adminSession(true, `${word} Eva`),
      adminSession(true, 'Fin Dva'),
      adminSession(false, 'Plain'),
    ]);
    const g = await newGroup();
    const g2 = await newGroup();
    groupId = g.id;
    const clientEmail = newEmail();
    const clientId = randomUUID();
    await test.deps.db.insert(user).values({
      id: clientId,
      email: clientEmail,
      name: 'Klient',
      role: 'client',
      emailVerified: true,
    });
    await addMember(test.deps.db, g.id, clientId);
    client = { id: clientId, cookie: await loginAs(test.app, clientEmail) };
    const requesterEmail = newEmail();
    const req = await createRequesterAccount(test.deps.db, {
      email: requesterEmail,
      name: 'Žiadateľ',
    });
    requester = { id: req.id, cookie: await loginAs(test.app, requesterEmail) };

    const upload = await test.app.inject({
      method: 'POST',
      url: '/api/finance/org/files',
      headers: {
        cookie: fin.cookie,
        'content-type': 'application/pdf',
        'x-file-name': `${word}.pdf`,
      },
      payload: Buffer.from('%PDF-1.4'),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    orgFile = upload.json<FileInfo>();
    const created = async (body: object) => {
      const res = await call('POST', '/api/finance/org/items', fin.cookie, body);
      expect(res.statusCode, res.body).toBe(201);
      return res.json<FinanceItemDetail>();
    };
    expense = await created({
      type: 'expense',
      expenseKind: 'salary',
      payeeId: fin.id,
      title: `${word} október`,
      body: `${word} 2 500 EUR`,
      amount: { amountMinor: 250_000, currency: 'EUR' },
      spentOn: '2041-10-31',
      fileIds: [orgFile.id],
    });
    sharedContract = await created({
      type: 'contract',
      title: `${word} grant`,
      amount: { amountMinor: 300_000, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      payerName: `${word} Mikroregión`,
      shares: [
        { groupId: g.id, amountMinor: 100_000 },
        { groupId: g2.id, amountMinor: 200_000 },
      ],
    });

    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('every route of the organisation answers 403 to an admin without the right, a client and a requester', async () => {
    const routes: [string, string, object?][] = [
      ['GET', '/api/finance/org/items'],
      ['GET', `/api/finance/org/items?q=${word}`],
      ['GET', '/api/finance/org/folders'],
      ['POST', '/api/finance/org/items', { type: 'note', title: 'x' }],
      ['POST', '/api/finance/org/folders', { name: 'x' }],
      ['GET', '/api/finance/payees'],
      ['GET', `/api/finance/items/${expense.id}`],
      ['GET', `/api/finance/items/${sharedContract.id}?group=${groupId}`],
      ['PATCH', `/api/finance/items/${expense.id}`, { updatedAt: expense.updatedAt, title: 'x' }],
      ['DELETE', `/api/finance/items/${expense.id}`],
      ['GET', '/api/finance/contracts?type=expense'],
      ['GET', '/api/finance/contracts?type=all'],
      ['GET', '/api/finance/overview?from=2041-01&to=2041-12'],
      ['GET', `/api/groups/${groupId}/finance/items`],
      ['GET', `/api/groups/${groupId}/finance/overview?from=2026-01&to=2026-12`],
    ];
    for (const who of [plain, client, requester]) {
      for (const [method, path, payload] of routes) {
        const res = await call(method, path, who.cookie, payload);
        expect({ who: who.id, method, path, code: res.statusCode }).toEqual({
          who: who.id,
          method,
          path,
          code: 403,
        });
        expect(res.body).not.toContain(word);
      }
      // The upload too, without a body ever being read.
      const upload = await test.app.inject({
        method: 'POST',
        url: '/api/finance/org/files',
        headers: { cookie: who.cookie, 'content-type': 'text/plain', 'x-file-name': 'a.txt' },
        payload: Buffer.from('x'),
      });
      expect(upload.statusCode).toBe(403);
      // The organisation's finance file does not open, even with its id.
      expect((await call('GET', `/api/files/${orgFile.id}`, who.cookie)).statusCode).toBe(404);
      // Nor the expense's reminders.
      expect(
        (await call('GET', `/api/finance-items/${expense.id}/reminders`, who.cookie)).statusCode,
      ).toBe(404);
    }
    // The item is still there: the refused writes changed nothing.
    const still = await call('GET', `/api/finance/items/${expense.id}`, fin.cookie);
    expect(still.json<FinanceItemDetail>().title).toBe(`${word} október`);
  });

  it('the knowledge lists and search never hold an expense, its payee or a shared contract', async () => {
    for (const path of [
      `/api/groups/${groupId}/knowledge`,
      `/api/groups/${groupId}/knowledge?q=${word}`,
      `/api/groups/${groupId}/knowledge?shareable=1&q=${word}`,
      `/api/knowledge?scope=all&q=${word}`,
      `/api/knowledge?clients=${groupId}`,
    ]) {
      const res = await call('GET', path, fin.cookie);
      expect({ path, code: res.statusCode }).toEqual({ path, code: 200 });
      expect({ path, leak: res.body.includes(word) }).toEqual({ path, leak: false });
    }
  });

  it("a client's tab never lists an expense, nor any organisation item but its shared contract", async () => {
    const res = await call('GET', `/api/groups/${groupId}/finance/items?type=expense`, fin.cookie);
    expect(res.json()).toEqual({ items: [], nextCursor: null });
    const all = await call('GET', `/api/groups/${groupId}/finance/items`, fin.cookie);
    expect(all.json<{ items: { id: string }[] }>().items.map((i) => i.id)).toEqual([
      sharedContract.id,
    ]);
    expect(
      (await call('GET', `/api/finance/items/${expense.id}?group=${groupId}`, fin.cookie))
        .statusCode,
    ).toBe(404);
    // The overview of the tab has no expenses and no organisation flag.
    const overview = await call(
      'GET',
      `/api/groups/${groupId}/finance/overview?from=2041-01&to=2041-12`,
      fin.cookie,
    );
    expect(overview.json()).toMatchObject({ organisation: false, expenses: [] });
  });

  it("an organisation item's change reaches the finance room only", async () => {
    const got = { fin: 0, plain: 0, client: 0 };
    const opened: Socket[] = [];
    for (const [key, session] of [
      ['fin', fin],
      ['plain', plain],
      ['client', client],
    ] as const) {
      const socket = await connected(session.cookie);
      opened.push(socket);
      if (key !== 'client') {
        await new Promise((resolve) => socket.emit('group:join', { groupId }, resolve));
      }
      socket.on(FinanceEvents.changed, () => (got[key] += 1));
    }
    const res = await call('POST', '/api/finance/org/items', fin.cookie, {
      type: 'note',
      title: 'Interná poznámka',
    });
    expect(res.statusCode).toBe(201);
    // Sentinel: a ping ack on each socket arrives after anything pushed to it before.
    await Promise.all(opened.map((x) => x.timeout(25_000).emitWithAck('system:ping')));
    expect(got).toEqual({ fin: 1, plain: 0, client: 0 });
  });

  it("an expense's reminder notifies finance admins only, without the amount, and none who lost the right", async () => {
    const put = await call('PUT', `/api/finance-items/${expense.id}/reminders`, fin.cookie, {
      times: [{ at: new Date(Date.now() + 86_400_000).toISOString() }],
      recipientIds: [fin2.id],
    });
    expect(put.statusCode, put.body).toBe(200);
    // A non-finance admin can never be a recipient.
    const bad = await call('PUT', `/api/finance-items/${expense.id}/reminders`, fin.cookie, {
      times: [{ at: new Date(Date.now() + 86_400_000).toISOString() }],
      recipientIds: [fin2.id, plain.id],
    });
    expect(bad.json()).toEqual({ error: 'invalid_recipient' });

    const [set] = await test.deps.db
      .select({ id: reminderSets.id })
      .from(reminderSets)
      .where(eq(reminderSets.financeItemId, expense.id));
    const [time] = await test.deps.db
      .update(reminderTimes)
      .set({ at: sql`now() - interval '1 minute'` })
      .where(eq(reminderTimes.setId, set!.id))
      .returning({ id: reminderTimes.id });
    const endpoints: Record<string, string> = {};
    for (const who of [fin, fin2]) {
      endpoints[who.id] = `https://push.example.test/${randomUUID()}`;
      await saveSubscription(test.deps.db, who.id, {
        endpoint: endpoints[who.id]!,
        p256dh: 'pk',
        auth: 'au',
        userAgent: null,
      });
    }
    // Recorded for both finance recipients, delivered later: fin2 loses the right in between.
    await fireDueReminders(quiet, { setIds: [set!.id] });
    const events = await test.deps.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.dedupeKey, `reminder:${time!.id}`));
    expect(events.map((e) => e.userId).sort()).toEqual([fin.id, fin2.id].sort());
    expect(events[0]!.groupId).toBeNull();
    expect(events[0]!.payload).toMatchObject({
      subjectKind: 'finance',
      subjectId: expense.id,
      groupId: null,
      dueOn: '2041-10-31',
      salary: true,
    });
    expect(JSON.stringify(events.map((e) => e.payload))).not.toMatch(/250000|2 500|EUR/);
    await setFinanceAccess(test.deps.db, fin2.id, null);
    await deliverPending(test.deps, { userIds: [fin.id, fin2.id] });
    const sentTo = (id: string) => test.push.sent.filter((s) => s.endpoint === endpoints[id]);
    expect(sentTo(fin2.id)).toEqual([]);
    expect(sentTo(fin.id)).toHaveLength(1);
    expect(sentTo(fin.id)[0]!.payload).toMatchObject({
      url: `/finance?item=${expense.id}`,
      tag: `finance:${expense.id}`,
    });
    expect(JSON.stringify(sentTo(fin.id)[0]!.payload)).not.toMatch(/250000|2 500|€|EUR/);
    await setFinanceAccess(test.deps.db, fin2.id, fin.id);
  });
});
