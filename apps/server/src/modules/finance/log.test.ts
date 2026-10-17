import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { RatesDto, WorkLogPageDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { insertTask } from '../../../test/tasks.js';
import { addMember, createGroup } from '../groups/service.js';
import { tasks } from '../tasks/schema.js';
import { tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, setFinanceAccess } from '../users/service.js';
import { overview } from './aggregates.js';
import { rateOn } from './rates.js';
import { financeItems, financeRates, financeTimeEntries } from './schema.js';
import { workLogPage } from './work-log.js';

/**
 * Part C (spec §3.4, §6.1–6.3): the rate lookup, the overview's money and hours, the work log's
 * pages and ticket units, manual entries and rates through the API, and the access of every
 * route. Each test makes its own client, so the shared database's other rows never count.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;

describe('rateOn', () => {
  const rates = [
    { id: 'start', effectiveFrom: null },
    { id: 'mar', effectiveFrom: '2026-03-01' },
    { id: 'jul', effectiveFrom: '2026-07-01' },
  ];
  it('picks the latest rate on or before the day, "from the start" before any date', () => {
    expect(rateOn(rates, '2020-01-01')?.id).toBe('start');
    expect(rateOn(rates, '2026-02-28')?.id).toBe('start');
    expect(rateOn(rates, '2026-03-01')?.id).toBe('mar');
    expect(rateOn(rates, '2026-06-30')?.id).toBe('mar');
    expect(rateOn(rates, '2027-01-01')?.id).toBe('jul');
  });
  it('has no rate before the first dated one when there is no "from the start" row', () => {
    expect(rateOn(rates.slice(1), '2026-02-01')).toBeNull();
    expect(rateOn([], '2026-02-01')).toBeNull();
  });
});

describe('finance overview, work log, rates and manual entries (part C)', () => {
  let test: TestApp;
  let superId: string;
  let finance: { id: string; cookie: string };
  let plain: { id: string; cookie: string };
  let client: { id: string; cookie: string };
  let sharedGroup: string;

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie?: string,
    payload?: object,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });

  const newGroup = async () =>
    (
      await createGroup(db(), {
        name: 'Firma',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      })
    ).id;
  const newAdmin = async (name: string) => (await addAdmin(db(), { email: newEmail(), name })).id;

  type EntryInput = {
    groupId: string;
    userId: string;
    minutes: number | null;
    workedOn: string | null;
    source?: 'task' | 'ticket' | 'manual';
    taskId?: string | null;
    ticketId?: string | null;
    linkedTicketId?: string | null;
    title?: string | null;
    coveredByTasks?: boolean;
    note?: string;
  };
  async function entry(input: EntryInput): Promise<string> {
    const id = randomUUID();
    const source = input.source ?? 'manual';
    await db()
      .insert(financeTimeEntries)
      .values({
        id,
        groupId: input.groupId,
        userId: input.userId,
        source,
        taskId: input.taskId ?? null,
        ticketId: input.ticketId ?? null,
        linkedTicketId: input.linkedTicketId ?? null,
        title: input.title ?? (source === 'manual' ? null : 'Stored title'),
        minutes: input.minutes,
        workedOn: input.workedOn,
        coveredByTasks: input.coveredByTasks ?? false,
        note: input.note ?? '',
        createdBy: superId,
        updatedBy: superId,
      });
    return id;
  }
  async function contract(
    groupId: string,
    amountMinor: number,
    startsOn: string,
    currency: 'EUR' | 'UAH' = 'EUR',
  ) {
    await db().insert(financeItems).values({
      id: randomUUID(),
      groupId,
      type: 'contract',
      title: 'Zmluva',
      amountMinor,
      currency,
      startsOn,
      endsOn: '2030-12-31',
      createdBy: superId,
    });
  }
  async function rate(userId: string, rateMinor: number, effectiveFrom: string | null) {
    await db().insert(financeRates).values({
      id: randomUUID(),
      userId,
      rateMinor,
      effectiveFrom,
      createdBy: superId,
    });
  }
  async function ticket(groupId: string, subject: string) {
    const id = randomUUID();
    const at = new Date();
    const [row] = await db()
      .insert(tickets)
      .values({ id, groupId, source: 'manual', subject, createdAt: at, updatedAt: at })
      .returning({ number: tickets.number });
    return { id, number: row!.number };
  }

  beforeAll(async () => {
    test = await buildTestApp();
    const email = newEmail();
    superId = randomUUID();
    await db()
      .insert(user)
      .values({ id: superId, email, name: 'Super', role: 'superadmin', emailVerified: true });
    const finEmail = newEmail();
    const finId = (await addAdmin(db(), { email: finEmail, name: 'Fin' })).id;
    await setFinanceAccess(db(), finId, superId);
    finance = { id: finId, cookie: await loginAs(test.app, finEmail) };
    const plainEmail = newEmail();
    plain = {
      id: (await addAdmin(db(), { email: plainEmail, name: 'Plain' })).id,
      cookie: await loginAs(test.app, plainEmail),
    };
    sharedGroup = await newGroup();
    const clientEmail = newEmail();
    const clientId = randomUUID();
    await db().insert(user).values({
      id: clientId,
      email: clientEmail,
      name: 'Client',
      role: 'client',
      emailVerified: true,
    });
    await addMember(db(), sharedGroup, clientId);
    client = { id: clientId, cookie: await loginAs(test.app, clientEmail) };
  });
  afterAll(() => test.close());

  describe('access', () => {
    const routes = (groupId: string): ['GET' | 'POST' | 'PATCH' | 'DELETE', string, object?][] => [
      ['GET', `/api/groups/${groupId}/finance/overview?from=2026-01&to=2026-12`],
      ['GET', `/api/groups/${groupId}/finance/work-log`],
      [
        'POST',
        `/api/groups/${groupId}/finance/time-entries`,
        { userId: 'x', workedOn: '2026-01-01', minutes: 1 },
      ],
      ['PATCH', `/api/finance/time-entries/${randomUUID()}`, { minutes: 1 }],
      ['DELETE', `/api/finance/time-entries/${randomUUID()}`],
      ['GET', '/api/finance/rates'],
      ['POST', '/api/finance/rates', { userId: 'x', rateMinor: 100, effectiveFrom: null }],
      ['DELETE', `/api/finance/rates/${randomUUID()}`],
    ];

    it('answers 401 without a session and 403 to a client and to an admin without the right', async () => {
      for (const [method, url, payload] of routes(sharedGroup)) {
        expect((await call(method, url, undefined, payload)).statusCode, url).toBe(401);
        expect((await call(method, url, plain.cookie, payload)).statusCode, url).toBe(403);
        expect((await call(method, url, client.cookie, payload)).statusCode, url).toBe(403);
      }
    });

    it('answers 404 for an unknown client and 400 for a bad filter', async () => {
      const unknown = randomUUID();
      expect(
        (await call('GET', `/api/groups/${unknown}/finance/overview`, finance.cookie)).statusCode,
      ).toBe(404);
      expect(
        (await call('GET', `/api/groups/${unknown}/finance/work-log`, finance.cookie)).statusCode,
      ).toBe(404);
      const bad = [
        `/api/groups/${sharedGroup}/finance/overview?from=2026-13&to=2026-12`,
        `/api/groups/${sharedGroup}/finance/overview?from=2026-05&to=2026-01`,
        `/api/groups/${sharedGroup}/finance/overview?from=2026-05`,
        `/api/groups/${sharedGroup}/finance/overview?from=2010-01&to=2026-12`,
        `/api/groups/${sharedGroup}/finance/work-log?before=nonsense`,
      ];
      for (const url of bad) {
        expect((await call('GET', url, finance.cookie)).json(), url).toEqual({
          error: 'invalid_filter',
        });
      }
    });
  });

  describe('overview', () => {
    it('sums contracts per currency, paid by the start date against today, never mixed', async () => {
      const groupId = await newGroup();
      await contract(groupId, 1_200_000, '2026-01-01');
      await contract(groupId, 300_000, '2026-10-17');
      await contract(groupId, 500_000, '2026-10-18');
      await contract(groupId, 700_000, '2026-11-02', 'UAH');
      await contract(groupId, 999, '2025-12-31'); // outside the range
      // 2026-10-17 21:30 UTC is already 2026-10-17 23:30 in Bratislava, still the 17th.
      const dto = await overview(
        db(),
        { kind: 'group', groupId },
        { from: '2026-01', to: '2026-12' },
        new Date('2026-10-17T21:30:00Z'),
      );
      expect(dto.months).toHaveLength(12);
      expect(dto.money).toEqual([
        {
          currency: 'EUR',
          paid: 1_500_000,
          toBePaid: 500_000,
          byMonth: [
            { month: '2026-01', paid: 1_200_000, toBePaid: 0 },
            { month: '2026-10', paid: 300_000, toBePaid: 500_000 },
          ],
        },
        {
          currency: 'UAH',
          paid: 0,
          toBePaid: 700_000,
          byMonth: [{ month: '2026-11', paid: 0, toBePaid: 700_000 }],
        },
      ]);
      // A minute after midnight in Bratislava the 18th's contract is paid.
      const next = await overview(
        db(),
        { kind: 'group', groupId },
        { from: '2026-01', to: '2026-12' },
        new Date('2026-10-17T22:01:00Z'),
      );
      expect(next.money[0]).toMatchObject({ paid: 2_000_000, toBePaid: 0 });
    });

    it('rounds the cost once per total, counts minutes without a rate, leaves requests out', async () => {
      const groupId = await newGroup();
      const eva = await newAdmin('Eva');
      const jan = await newAdmin('Jan');
      await rate(eva, 100, null); // 1 € an hour from the start
      await rate(eva, 6000, '2026-03-01'); // 60 € an hour from March
      // Eva: two 1-minute entries at 1 €/h (1.67 cents each): one total of 3 cents, not 2 + 2.
      await entry({ groupId, userId: eva, minutes: 1, workedOn: '2026-01-31' });
      await entry({ groupId, userId: eva, minutes: 1, workedOn: '2026-01-31' });
      await entry({ groupId, userId: eva, minutes: 90, workedOn: '2026-03-01' }); // 90 €
      // Jan has no rate.
      await entry({ groupId, userId: jan, minutes: 30, workedOn: '2026-02-01' });
      // A request (not answered) and an entry filled before completion count nowhere.
      await entry({
        groupId,
        userId: jan,
        minutes: null,
        workedOn: '2026-02-01',
        source: 'task',
        title: 'T',
      });
      await entry({
        groupId,
        userId: jan,
        minutes: 600,
        workedOn: null,
        source: 'task',
        title: 'T',
      });
      const dto = await overview(
        db(),
        { kind: 'group', groupId },
        { from: '2026-01', to: '2026-03' },
      );
      expect(dto.cost).toEqual({
        total: 9003,
        byMonth: [
          { month: '2026-01', amount: 3 },
          { month: '2026-03', amount: 9000 },
        ],
      });
      expect(dto.hours).toMatchObject({ minutes: 122, missingRateMinutes: 30 });
      expect(
        dto.hours.byAdmin.map((a) => [a.name, a.minutes, a.cost, a.missingRateMinutes]),
      ).toEqual([
        ['Eva', 92, 9003, 0],
        ['Jan', 30, null, 30],
      ]);
      expect(dto.hours.byAdmin[0]!.byMonth).toEqual([
        { month: '2026-01', minutes: 2 },
        { month: '2026-03', minutes: 90 },
      ]);
      // Month boundaries: the 31 January entries are January's, the 1 February one February's.
      const feb = await overview(
        db(),
        { kind: 'group', groupId },
        { from: '2026-02', to: '2026-02' },
      );
      expect(feb.hours.minutes).toBe(30);
    });

    it('counts a task done by two admins once in the total and once for each admin', async () => {
      const groupId = await newGroup();
      const eva = await newAdmin('Eva');
      const jan = await newAdmin('Jan');
      const taskId = await insertTask(db(), { groupId, createdBy: eva, done: true });
      const { id: ticketId } = await ticket(groupId, 'Login broken');
      await entry({
        groupId,
        userId: eva,
        minutes: 60,
        workedOn: '2026-05-04',
        source: 'task',
        taskId,
      });
      await entry({
        groupId,
        userId: jan,
        minutes: 0,
        workedOn: '2026-05-04',
        source: 'task',
        taskId,
      });
      await entry({
        groupId,
        userId: eva,
        minutes: 30,
        workedOn: '2026-05-05',
        source: 'ticket',
        ticketId,
      });
      const dto = await overview(
        db(),
        { kind: 'group', groupId },
        { from: '2026-05', to: '2026-05' },
      );
      expect(dto.hours).toMatchObject({ minutes: 90, taskCount: 1, ticketCount: 1 });
      expect(dto.hours.byAdmin.map((a) => [a.name, a.taskCount, a.ticketCount])).toEqual([
        ['Eva', 1, 1],
        ['Jan', 1, 0],
      ]);
    });

    it('answers over HTTP, "all time" from the data', async () => {
      const groupId = await newGroup();
      await contract(groupId, 100, '2024-03-15');
      await entry({ groupId, userId: finance.id, minutes: 15, workedOn: '2025-01-02' });
      const res = await call('GET', `/api/groups/${groupId}/finance/overview`, finance.cookie);
      expect(res.statusCode).toBe(200);
      const dto = res.json<{ from: string; to: string; hours: { minutes: number } }>();
      expect(dto.from).toBe('2024-03');
      expect(dto.to >= '2026-10').toBe(true);
      expect(dto.hours.minutes).toBe(15);
    });
  });

  describe('work log', () => {
    it('pages 200 entries newest first with the full totals of each month it touches', async () => {
      const groupId = await newGroup();
      const eva = await newAdmin('Eva');
      await rate(eva, 6000, null);
      // 205 entries of 10 minutes: one a day from 2026-01-01 on (January 31 days, ...).
      for (let i = 0; i < 205; i++) {
        const day = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
        await entry({ groupId, userId: eva, minutes: 10, workedOn: day });
      }
      const first = await workLogPage(db(), { kind: 'group', groupId }, null, null);
      expect(first.entries).toHaveLength(200);
      expect(first.entries[0]!.workedOn).toBe('2026-07-24');
      expect(first.entries.at(-1)!.workedOn).toBe('2026-01-06');
      expect(first.entries[0]).toMatchObject({ userName: 'Eva', minutes: 10, cost: 1000 });
      // Every month from January to July with its full totals (January has 31 entries though
      // the page holds 26 of them).
      expect(first.months.map((m) => [m.month, m.minutes])).toEqual([
        ['2026-07', 240],
        ['2026-06', 300],
        ['2026-05', 310],
        ['2026-04', 300],
        ['2026-03', 310],
        ['2026-02', 280],
        ['2026-01', 310],
      ]);
      expect(first.months[0]!.byAdmin).toMatchObject([{ name: 'Eva', minutes: 240, cost: 24000 }]);
      expect(first.summary).toMatchObject({ minutes: 2050, cost: 205000, taskCount: 0 });
      expect(first.before).not.toBeNull();

      const second = await workLogPage(db(), { kind: 'group', groupId }, null, first.before);
      expect(second.entries.map((e) => e.workedOn)).toEqual([
        '2026-01-05',
        '2026-01-04',
        '2026-01-03',
        '2026-01-02',
        '2026-01-01',
      ]);
      expect(second.months.map((m) => m.month)).toEqual(['2026-01']);
      expect(second.summary).toBeNull();
      expect(second.before).toBeNull();

      // The period filter: only March.
      const march = await workLogPage(
        db(),
        { kind: 'group', groupId },
        { from: '2026-03', to: '2026-03' },
        null,
      );
      expect(march.entries).toHaveLength(31);
      expect(march.summary).toMatchObject({ minutes: 310 });
      expect(march.before).toBeNull();
    });

    it('shows requests waiting for time, deleted tasks by their stored title, ticket units', async () => {
      const groupId = await newGroup();
      const eva = await newAdmin('Eva');
      const jan = await newAdmin('Jan');
      const { id: ticketId, number } = await ticket(groupId, 'Login broken');
      const linkedTask = await insertTask(db(), {
        groupId,
        createdBy: eva,
        done: true,
        title: 'Fix login',
      });
      const goneTask = await insertTask(db(), {
        groupId,
        createdBy: eva,
        done: true,
        title: 'Old',
      });
      await entry({
        groupId,
        userId: eva,
        minutes: 0,
        workedOn: '2026-04-02',
        source: 'ticket',
        ticketId,
        coveredByTasks: true,
        title: 'Login broken',
      });
      await entry({
        groupId,
        userId: eva,
        minutes: 45,
        workedOn: '2026-04-01',
        source: 'task',
        taskId: linkedTask,
        linkedTicketId: ticketId,
        title: 'Fix login',
      });
      await entry({
        groupId,
        userId: jan,
        minutes: null,
        workedOn: '2026-04-01',
        source: 'task',
        taskId: linkedTask,
        linkedTicketId: ticketId,
        title: 'Fix login',
      });
      await entry({
        groupId,
        userId: eva,
        minutes: 20,
        workedOn: '2026-03-30',
        source: 'task',
        taskId: goneTask,
        title: 'Old, as stored',
      });
      await db().delete(tasks).where(eq(tasks.id, goneTask));

      const page = await workLogPage(db(), { kind: 'group', groupId }, null, null);
      expect(
        page.entries.map((e) => [
          e.workedOn,
          e.userName,
          e.source,
          e.minutes,
          e.title,
          e.unitTicketId,
          e.subjectDeleted,
          e.coveredByTasks,
        ]),
      ).toEqual([
        ['2026-04-02', 'Eva', 'ticket', 0, 'Login broken', ticketId, false, true],
        expect.anything(),
        expect.anything(),
        ['2026-03-30', 'Eva', 'task', 20, 'Old, as stored', null, true, false],
      ]);
      const april1 = page.entries.filter((e) => e.workedOn === '2026-04-01');
      expect(april1.map((e) => [e.userName, e.minutes, e.title, e.unitTicketId]).sort()).toEqual([
        ['Eva', 45, 'Fix login', ticketId],
        ['Jan', null, 'Fix login', ticketId],
      ]);
      expect(page.tickets).toEqual([{ id: ticketId, number, title: 'Login broken' }]);
      // The request is not counted; the (b) answer adds nothing; the ticket counts once.
      expect(page.summary).toMatchObject({ minutes: 65, taskCount: 2, ticketCount: 1 });
      expect(page.months.find((m) => m.month === '2026-04')).toMatchObject({
        minutes: 45,
        taskCount: 1,
        ticketCount: 1,
      });
    });

    it('reads a page in a fixed number of queries, whatever its size', async () => {
      const groupId = await newGroup();
      const admins = await Promise.all(['A', 'B', 'C'].map((n) => newAdmin(n)));
      const { id: ticketId } = await ticket(groupId, 'T');
      for (let i = 0; i < 30; i++) {
        const taskId = await insertTask(db(), {
          groupId,
          createdBy: superId,
          done: true,
          title: `Task ${i}`,
        });
        await entry({
          groupId,
          userId: admins[i % 3]!,
          minutes: 15,
          workedOn: `2026-0${(i % 6) + 1}-10`,
          source: 'task',
          taskId,
          linkedTicketId: i % 2 ? ticketId : null,
        });
      }
      const counting = createCountingDb();
      try {
        // The first run opens the pool's connections (their setup queries count too).
        await workLogPage(counting.db, { kind: 'group', groupId }, null, null);
        counting.reset();
        await workLogPage(counting.db, { kind: 'group', groupId }, null, null);
        // entries, month totals, summary, task titles, tickets, names
        expect(counting.count()).toBe(6);
      } finally {
        await counting.close();
      }
    });

    it('answers over HTTP', async () => {
      const groupId = await newGroup();
      await entry({
        groupId,
        userId: finance.id,
        minutes: 15,
        workedOn: '2026-02-02',
        note: 'Call',
      });
      const res = await call(
        'GET',
        `/api/groups/${groupId}/finance/work-log?from=2026-01&to=2026-12`,
        finance.cookie,
      );
      expect(res.statusCode).toBe(200);
      expect(res.json<WorkLogPageDto>().entries).toMatchObject([
        { minutes: 15, note: 'Call', source: 'manual' },
      ]);
    });
  });

  describe('manual entries and corrections', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
      new Date(),
    );

    it('adds an entry for any admin, 0 allowed, never for a client or in the future', async () => {
      const groupId = await newGroup();
      const url = `/api/groups/${groupId}/finance/time-entries`;
      const ok = await call('POST', url, finance.cookie, {
        userId: plain.id,
        workedOn: today,
        minutes: 120,
        note: ' Meeting ',
      });
      expect(ok.statusCode).toBe(201);
      const zero = await call('POST', url, finance.cookie, {
        userId: plain.id,
        workedOn: '2026-01-05',
        minutes: 0,
      });
      expect(zero.statusCode).toBe(201);
      const [row] = await db()
        .select()
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.id, ok.json<{ id: string }>().id));
      expect(row).toMatchObject({
        source: 'manual',
        minutes: 120,
        note: 'Meeting',
        workedOn: today,
        createdBy: finance.id,
      });

      expect(
        (
          await call('POST', url, finance.cookie, {
            userId: client.id,
            workedOn: today,
            minutes: 5,
          })
        ).json(),
      ).toEqual({ error: 'invalid_assignee' });
      expect(
        (
          await call('POST', url, finance.cookie, {
            userId: plain.id,
            workedOn: '2999-01-01',
            minutes: 5,
          })
        ).json(),
      ).toEqual({ error: 'validation_failed' });
      expect(
        (
          await call('POST', url, finance.cookie, {
            userId: plain.id,
            workedOn: today,
            minutes: 6001,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call('POST', url, finance.cookie, {
            userId: plain.id,
            workedOn: '2026-02-30',
            minutes: 5,
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call('POST', `/api/groups/${randomUUID()}/finance/time-entries`, finance.cookie, {
            userId: plain.id,
            workedOn: today,
            minutes: 5,
          })
        ).statusCode,
      ).toBe(404);
    });

    it('edits a manual entry fully, a task entry by minutes only, and deletes what may go', async () => {
      const groupId = await newGroup();
      const manual = await entry({
        groupId,
        userId: plain.id,
        minutes: 30,
        workedOn: '2026-02-02',
      });
      expect(
        (
          await call('PATCH', `/api/finance/time-entries/${manual}`, finance.cookie, {
            minutes: 45,
            workedOn: '2026-02-03',
            note: 'Fixed',
          })
        ).statusCode,
      ).toBe(204);
      const [m] = await db()
        .select()
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.id, manual));
      expect(m).toMatchObject({
        minutes: 45,
        workedOn: '2026-02-03',
        note: 'Fixed',
        updatedBy: finance.id,
      });

      const { id: ticketId } = await ticket(groupId, 'T');
      const covered = await entry({
        groupId,
        userId: plain.id,
        minutes: 0,
        workedOn: '2026-02-02',
        source: 'ticket',
        ticketId,
        coveredByTasks: true,
      });
      expect(
        (
          await call('PATCH', `/api/finance/time-entries/${covered}`, finance.cookie, {
            workedOn: '2026-02-01',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call('PATCH', `/api/finance/time-entries/${covered}`, finance.cookie, {
            minutes: 20,
          })
        ).statusCode,
      ).toBe(204);
      const [c] = await db()
        .select()
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.id, covered));
      expect(c).toMatchObject({ minutes: 20, coveredByTasks: false });
      // A filled task or ticket entry is reset to 0, never deleted; a request may be deleted.
      expect(
        (await call('DELETE', `/api/finance/time-entries/${covered}`, finance.cookie)).statusCode,
      ).toBe(400);
      const requested = await entry({
        groupId,
        userId: plain.id,
        minutes: null,
        workedOn: '2026-02-02',
        source: 'task',
        title: 'T',
      });
      expect(
        (await call('DELETE', `/api/finance/time-entries/${requested}`, finance.cookie)).statusCode,
      ).toBe(204);
      expect(
        (await call('DELETE', `/api/finance/time-entries/${manual}`, finance.cookie)).statusCode,
      ).toBe(204);
      expect(
        (await call('DELETE', `/api/finance/time-entries/${manual}`, finance.cookie)).statusCode,
      ).toBe(404);
      expect(
        (await call('PATCH', `/api/finance/time-entries/${manual}`, finance.cookie, { minutes: 1 }))
          .statusCode,
      ).toBe(404);
    });

    it('fills a request: the entry starts counting', async () => {
      const groupId = await newGroup();
      const requested = await entry({
        groupId,
        userId: plain.id,
        minutes: null,
        workedOn: '2026-02-02',
        source: 'task',
        title: 'T',
      });
      expect(
        (
          await call('PATCH', `/api/finance/time-entries/${requested}`, finance.cookie, {
            minutes: 60,
          })
        ).statusCode,
      ).toBe(204);
      const [row] = await db()
        .select()
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.id, requested));
      expect(row!.filledAt).not.toBeNull();
      const dto = await overview(
        db(),
        { kind: 'group', groupId },
        { from: '2026-02', to: '2026-02' },
      );
      expect(dto.hours.minutes).toBe(60);
    });
  });

  describe('rates', () => {
    it('lists admins with today’s rate and history, replaces a day, deletes a row', async () => {
      const eva = await newAdmin('Eva Rate');
      const url = '/api/finance/rates';
      const first = await call('POST', url, finance.cookie, {
        userId: eva,
        rateMinor: 4000,
        effectiveFrom: null,
      });
      expect(first.statusCode).toBe(201);
      expect(first.json()).toMatchObject({
        userId: eva,
        rateMinor: 4000,
        currency: 'EUR',
        effectiveFrom: null,
        createdByName: 'Fin',
      });
      await call('POST', url, finance.cookie, {
        userId: eva,
        rateMinor: 5000,
        effectiveFrom: '2026-01-01',
      });
      await call('POST', url, finance.cookie, {
        userId: eva,
        rateMinor: 9000,
        effectiveFrom: '2999-01-01',
      });
      // The same day again corrects that row.
      const again = await call('POST', url, finance.cookie, {
        userId: eva,
        rateMinor: 5500,
        effectiveFrom: '2026-01-01',
      });
      expect(again.statusCode).toBe(201);

      const list = (await call('GET', url, finance.cookie)).json<RatesDto>();
      const row = list.admins.find((a) => a.userId === eva)!;
      expect(row).toMatchObject({ name: 'Eva Rate', active: true, current: { rateMinor: 5500 } });
      expect(row.history.map((r) => [r.effectiveFrom, r.rateMinor])).toEqual([
        ['2999-01-01', 9000],
        ['2026-01-01', 5500],
        [null, 4000],
      ]);
      expect(list.admins.some((a) => a.userId === client.id)).toBe(false);

      expect(
        (await call('DELETE', `${url}/${again.json<{ id: string }>().id}`, finance.cookie))
          .statusCode,
      ).toBe(204);
      const after = (await call('GET', url, finance.cookie)).json<RatesDto>();
      expect(after.admins.find((a) => a.userId === eva)!.current).toMatchObject({
        rateMinor: 4000,
      });
      expect((await call('DELETE', `${url}/${randomUUID()}`, finance.cookie)).statusCode).toBe(404);
      expect(
        (
          await call('POST', url, finance.cookie, {
            userId: client.id,
            rateMinor: 100,
            effectiveFrom: null,
          })
        ).json(),
      ).toEqual({ error: 'invalid_assignee' });
      expect(
        (
          await call('POST', url, finance.cookie, {
            userId: eva,
            rateMinor: 0,
            effectiveFrom: null,
          })
        ).statusCode,
      ).toBe(400);
    });
  });
});
