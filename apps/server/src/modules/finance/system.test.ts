import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import {
  FinanceEvents,
  type ContractsPage,
  type FinanceOverviewDto,
  type HoursRankingPage,
  type PaidRankingPage,
  type WorkLogPageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, setFinanceAccess } from '../users/service.js';
import { hoursRanking, paidRange, paidRanking } from './rankings.js';
import { financeItems, financeRates, financeTimeEntries } from './schema.js';
import { workLogPage } from './work-log.js';

/**
 * Part D (spec §6.2, §7): the system-wide routes, the two rankings (ties, months, currency,
 * admin filter, cost sort with missing rates, paging), the contracts table and the time without
 * a client ("Bez klienta", owner decision 24) shown on the all-clients view only. Each test makes
 * its own clients (and admins where it ranks hours), so the shared database's rows never count.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;

/** Rows by rank, then name: equal values share a rank and are ordered by client id (random here). */
const byRank = <T extends unknown[]>(rows: T[]) =>
  [...rows].sort((x, y) => Number(x[0]) - Number(y[0]) || String(x[1]).localeCompare(String(y[1])));

describe('the system-wide finance page (part D)', () => {
  let test: TestApp;
  let superId: string;
  let finance: { id: string; cookie: string };
  let plain: { id: string; cookie: string };
  let client: { id: string; cookie: string };
  let sharedGroup: string;

  const db = () => test.deps.db;
  const get = (url: string, cookie?: string) =>
    test.app.inject({ method: 'GET', url, headers: cookie ? { cookie } : {} });

  const newGroup = async (name = 'Firma') =>
    (
      await createGroup(db(), {
        name,
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      })
    ).id;
  const newAdmin = async (name: string) => (await addAdmin(db(), { email: newEmail(), name })).id;

  async function entry(input: {
    groupId: string | null;
    userId: string;
    minutes: number | null;
    workedOn: string;
    source?: 'manual' | 'ticket';
  }) {
    const source = input.source ?? (input.groupId === null ? 'ticket' : 'manual');
    await db()
      .insert(financeTimeEntries)
      .values({
        id: randomUUID(),
        groupId: input.groupId,
        userId: input.userId,
        source,
        title: source === 'manual' ? null : 'Intake ticket',
        minutes: input.minutes,
        workedOn: input.workedOn,
        createdBy: superId,
        updatedBy: superId,
      });
  }
  async function contract(
    groupId: string,
    amountMinor: number,
    startsOn: string,
    extra: { currency?: 'EUR' | 'UAH'; endsOn?: string; title?: string; number?: string } = {},
  ) {
    const id = randomUUID();
    const title = extra.title ?? 'Zmluva';
    await db()
      .insert(financeItems)
      .values({
        id,
        groupId,
        type: 'contract',
        title,
        contractNumber: extra.number ?? null,
        amountMinor,
        currency: extra.currency ?? 'EUR',
        startsOn,
        endsOn: extra.endsOn ?? '2030-12-31',
        searchText: title.toLowerCase(),
        createdBy: superId,
      });
    return id;
  }
  async function note(groupId: string, title: string) {
    const id = randomUUID();
    await db().insert(financeItems).values({
      id,
      groupId,
      type: 'note',
      title,
      searchText: title.toLowerCase(),
      createdBy: superId,
    });
    return id;
  }
  async function rate(userId: string, rateMinor: number) {
    await db()
      .insert(financeRates)
      .values({ id: randomUUID(), userId, rateMinor, effectiveFrom: null, createdBy: superId });
  }

  beforeAll(async () => {
    test = await buildTestApp();
    superId = randomUUID();
    await db().insert(user).values({
      id: superId,
      email: newEmail(),
      name: 'Super',
      role: 'superadmin',
      emailVerified: true,
    });
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

  describe('access and filters', () => {
    const urls = [
      '/api/finance/overview',
      '/api/finance/work-log',
      '/api/finance/contracts',
      '/api/finance/rankings/paid?year=2026',
      '/api/finance/rankings/hours?from=2026-01&to=2026-12',
    ];

    it('answers 401 without a session and 403 to a client and to an admin without the right', async () => {
      for (const url of urls) {
        expect((await get(url)).statusCode, url).toBe(401);
        expect((await get(url, plain.cookie)).statusCode, url).toBe(403);
        expect((await get(url, client.cookie)).statusCode, url).toBe(403);
        expect((await get(url, finance.cookie)).statusCode, url).toBe(200);
      }
    });

    it('answers 400 invalid_filter for a bad clients filter, month, cursor or sort', async () => {
      const bad = [
        '/api/finance/overview?clients=a%20b',
        `/api/finance/overview?clients=${'x'.repeat(70)}`,
        '/api/finance/overview?from=2026-05&to=2026-01',
        '/api/finance/work-log?clients=%3Cscript%3E',
        '/api/finance/work-log?before=nonsense',
        '/api/finance/contracts?sort=title',
        '/api/finance/contracts?after=nonsense',
        '/api/finance/rankings/paid?from=2026-01',
        '/api/finance/rankings/paid?from=2026-05&to=2026-01',
        '/api/finance/rankings/hours?to=2026-01',
        '/api/finance/contracts?from=2026-01',
        '/api/finance/contracts?from=2026-05&to=2026-01',
        '/api/finance/rankings/paid?year=2026&month=13',
        '/api/finance/rankings/paid?year=2026&currency=USD',
        '/api/finance/rankings/paid?year=2026&after=bm9uc2Vuc2U',
        '/api/finance/rankings/hours?from=2026-01',
        '/api/finance/rankings/hours?from=2026-05&to=2026-01',
        '/api/finance/rankings/hours?from=2026-01&to=2026-12&sort=money',
        '/api/finance/rankings/hours?from=2010-01&to=2026-12',
        '/api/finance/rankings/hours?from=2026-01&to=2026-12&admin=a%20b',
      ];
      for (const url of bad) {
        expect((await get(url, finance.cookie)).json(), url).toEqual({ error: 'invalid_filter' });
      }
    });
  });

  describe('paid ranking', () => {
    const now = new Date('2026-10-17T10:00:00Z');

    it('ranks the chosen clients by contracts started in the year up to today, ties shared', async () => {
      const a = await newGroup('Alfa');
      const b = await newGroup('Beta');
      const c = await newGroup('Gama');
      const d = await newGroup('Delta');
      await contract(a, 500_000, '2026-02-01');
      await contract(a, 100_000, '2026-10-17'); // today: paid
      await contract(b, 600_000, '2026-03-15');
      await contract(c, 300_000, '2026-05-01');
      await contract(c, 900_000, '2026-10-18'); // tomorrow: not paid yet
      await contract(c, 800_000, '2025-12-31'); // last year
      await contract(d, 999_999, '2026-04-01', { currency: 'UAH' });
      const scope = { kind: 'groups' as const, groupIds: [a, b, c, d] };
      const page = await paidRanking(
        db(),
        scope,
        { range: paidRange({ year: 2026 }), currency: 'EUR' },
        now,
      );
      expect(byRank(page.rows.map((r) => [r.rank, r.groupName, r.amountMinor]))).toEqual([
        [1, 'Alfa', 600_000],
        [1, 'Beta', 600_000],
        [3, 'Gama', 300_000],
      ]);
      expect(page.total).toBe(1_500_000);
      expect(page.max).toBe(600_000);
      expect(page.nextCursor).toBeNull();

      const may = await paidRanking(
        db(),
        scope,
        { range: paidRange({ year: 2026, month: 5 }), currency: 'EUR' },
        now,
      );
      expect(may.rows.map((r) => [r.groupName, r.amountMinor])).toEqual([['Gama', 300_000]]);
      const uah = await paidRanking(
        db(),
        scope,
        { range: paidRange({ year: 2026 }), currency: 'UAH' },
        now,
      );
      expect(uah.rows.map((r) => [r.groupName, r.amountMinor])).toEqual([['Delta', 999_999]]);
    });

    it('pages 20 at a time without repeating or skipping a client', async () => {
      const ids: string[] = [];
      for (let n = 0; n < 23; n++) {
        const id = await newGroup(`Client ${n}`);
        ids.push(id);
        await contract(id, 1000 * (n % 5) + 1000, '2026-01-10');
      }
      const scope = { kind: 'groups' as const, groupIds: ids };
      const first = await paidRanking(
        db(),
        scope,
        { range: paidRange({ year: 2026 }), currency: 'EUR' },
        now,
      );
      expect(first.rows).toHaveLength(20);
      expect(first.nextCursor).not.toBeNull();
      const second = await paidRanking(
        db(),
        scope,
        { range: paidRange({ year: 2026 }), currency: 'EUR', after: first.nextCursor! },
        now,
      );
      expect(second.rows).toHaveLength(3);
      expect(second.nextCursor).toBeNull();
      const all = [...first.rows, ...second.rows];
      expect(new Set(all.map((r) => r.groupId)).size).toBe(23);
      const amounts = all.map((r) => r.amountMinor);
      expect(amounts).toEqual([...amounts].sort((x, y) => y - x));
      expect(second.total).toBe(first.total);
    });
  });

  describe('hours ranking', () => {
    it('ranks by hours or by cost (missing rates count 0), one admin or all', async () => {
      const a = await newGroup('Alfa');
      const b = await newGroup('Beta');
      const c = await newGroup('Gama');
      const rated = await newAdmin('Rated');
      const cheap = await newAdmin('Cheap');
      const unrated = await newAdmin('Unrated');
      await rate(rated, 6000); // 60 €/h
      await rate(cheap, 1000); // 10 €/h
      await entry({ groupId: a, userId: rated, minutes: 60, workedOn: '2026-03-01' });
      await entry({ groupId: b, userId: cheap, minutes: 180, workedOn: '2026-03-02' });
      await entry({ groupId: c, userId: unrated, minutes: 600, workedOn: '2026-03-03' });
      await entry({ groupId: c, userId: rated, minutes: 30, workedOn: '2026-03-04' });
      await entry({ groupId: a, userId: rated, minutes: 999, workedOn: '2025-12-31' }); // outside
      await entry({
        groupId: b,
        userId: cheap,
        minutes: null,
        workedOn: '2026-03-05',
        source: 'ticket',
      }); // requested
      const scope = { kind: 'groups' as const, groupIds: [a, b, c] };
      const range = { from: '2026-01', to: '2026-12' };

      const byHours = await hoursRanking(db(), scope, { range, sort: 'hours' });
      expect(byHours.rows.map((r) => [r.rank, r.groupName, r.minutes, r.cost])).toEqual([
        [1, 'Gama', 630, 3000],
        [2, 'Beta', 180, 3000],
        [3, 'Alfa', 60, 6000],
      ]);
      expect(byHours.rows[0]!.missingRateMinutes).toBe(600);
      expect(byHours.max).toBe(630);

      const byCost = await hoursRanking(db(), scope, { range, sort: 'cost' });
      expect(byRank(byCost.rows.map((r) => [r.rank, r.groupName]))).toEqual([
        [1, 'Alfa'],
        [2, 'Beta'],
        [2, 'Gama'],
      ]);
      expect(byCost.max).toBe(6000);

      const onlyRated = await hoursRanking(db(), scope, { range, admin: rated, sort: 'cost' });
      expect(onlyRated.rows.map((r) => [r.groupName, r.minutes, r.cost])).toEqual([
        ['Alfa', 60, 6000],
        ['Gama', 30, 3000],
      ]);
      const onlyUnrated = await hoursRanking(db(), scope, { range, admin: unrated, sort: 'cost' });
      expect(onlyUnrated.rows.map((r) => [r.groupName, r.minutes, r.cost])).toEqual([
        ['Gama', 600, null],
      ]);
    });

    it('ranks the time without a client as one row, on the all-clients view only', async () => {
      const a = await newGroup('Alfa');
      const admin = await newAdmin('Intake');
      await entry({ groupId: a, userId: admin, minutes: 45, workedOn: '2026-06-01' });
      await entry({ groupId: null, userId: admin, minutes: 90, workedOn: '2026-06-02' });
      await entry({ groupId: null, userId: admin, minutes: 30, workedOn: '2026-06-03' });
      const range = { from: '2026-06', to: '2026-06' };
      const all = await hoursRanking(db(), { kind: 'all' }, { range, admin, sort: 'hours' });
      expect(all.rows.map((r) => [r.groupId, r.groupName, r.minutes])).toEqual([
        [null, '', 120],
        [a, 'Alfa', 45],
      ]);
      const chosen = await hoursRanking(
        db(),
        { kind: 'groups', groupIds: [a] },
        { range, admin, sort: 'hours' },
      );
      expect(chosen.rows.map((r) => r.groupId)).toEqual([a]);

      const res = await get(
        `/api/finance/rankings/hours?from=2026-06&to=2026-06&admin=${admin}`,
        finance.cookie,
      );
      expect((res.json() as HoursRankingPage).rows.map((r) => r.minutes)).toEqual([120, 45]);
    });
  });

  describe('overview and work log across clients', () => {
    it('sums the chosen clients, and the all view adds the time without a client', async () => {
      const a = await newGroup('Alfa');
      const b = await newGroup('Beta');
      const admin = await newAdmin('Wide');
      await entry({ groupId: a, userId: admin, minutes: 60, workedOn: '2026-04-01' });
      await entry({ groupId: b, userId: admin, minutes: 120, workedOn: '2026-04-02' });
      await entry({ groupId: null, userId: admin, minutes: 30, workedOn: '2026-04-03' });
      await contract(a, 100_000, '2026-04-01');
      await contract(b, 200_000, '2026-04-10');

      const res = await get(
        `/api/finance/overview?clients=${a},${b}&from=2026-04&to=2026-04`,
        finance.cookie,
      );
      const dto = res.json() as FinanceOverviewDto;
      expect(dto.money[0]!.paid + dto.money[0]!.toBePaid).toBe(300_000);
      expect(dto.hours.byAdmin.find((x) => x.userId === admin)?.minutes).toBe(180);

      const all = (
        await get('/api/finance/overview?from=2026-04&to=2026-04', finance.cookie)
      ).json() as FinanceOverviewDto;
      expect(all.hours.byAdmin.find((x) => x.userId === admin)?.minutes).toBe(210);
    });

    it('names each entry’s client and each month’s top clients; "Bez klienta" only on all', async () => {
      const a = await newGroup('Alfa');
      const b = await newGroup('Beta');
      const admin = await newAdmin('Logger');
      // A far future month of its own (a run's own year), so no other entry mixes in.
      const y = String(3000 + Math.floor(Math.random() * 5000));
      await entry({ groupId: a, userId: admin, minutes: 60, workedOn: `${y}-02-01` });
      await entry({ groupId: b, userId: admin, minutes: 120, workedOn: `${y}-02-02` });
      await entry({ groupId: null, userId: admin, minutes: 90, workedOn: `${y}-02-03` });
      const range = { from: `${y}-02`, to: `${y}-02` };

      const chosen = await workLogPage(db(), { kind: 'groups', groupIds: [a, b] }, range, null);
      expect(chosen.entries.map((x) => [x.groupId, x.groupName, x.minutes])).toEqual([
        [b, 'Beta', 120],
        [a, 'Alfa', 60],
      ]);
      expect(chosen.months[0]!.topClients).toEqual([
        { groupId: b, name: 'Beta', minutes: 120 },
        { groupId: a, name: 'Alfa', minutes: 60 },
      ]);

      const res = await get(`/api/finance/work-log?from=${y}-02&to=${y}-02`, finance.cookie);
      const all = res.json() as WorkLogPageDto;
      expect(all.entries.map((x) => [x.groupId, x.groupName, x.minutes])).toEqual([
        [null, null, 90],
        [b, 'Beta', 120],
        [a, 'Alfa', 60],
      ]);
      expect(all.months[0]!.topClients?.map((x) => x.groupId)).toEqual([b, null, a]);
      expect(all.summary?.minutes).toBe(270);

      // A client's own tab never sees the time without a client nor names clients.
      const tab = await workLogPage(db(), { kind: 'group', groupId: a }, range, null);
      expect(tab.entries.map((x) => x.minutes)).toEqual([60]);
      expect(tab.entries[0]!.groupName).toBeUndefined();
      expect(tab.months[0]!.topClients).toBeUndefined();
    });
  });

  describe('contracts table', () => {
    it('lists the chosen clients’ contracts with their client, sorted, and searches every item', async () => {
      const a = await newGroup('Alfa');
      const b = await newGroup('Beta');
      const early = await contract(a, 300_000, '2025-01-01', { endsOn: '2025-12-31' });
      const late = await contract(b, 100_000, '2026-06-01', { endsOn: '2027-05-31' });
      const mid = await contract(b, 900_000, '2026-01-01', {
        endsOn: '2026-11-30',
        title: 'Servis zmluva',
      });
      const memo = await note(a, 'Servis poznamka');
      const page = async (query: string) =>
        (
          await get(`/api/finance/contracts?clients=${a},${b}${query}`, finance.cookie)
        ).json() as ContractsPage;

      expect((await page('')).items.map((x) => x.id)).toEqual([late, mid, early]);
      const byEnd = await page('&sort=end&dir=asc');
      expect(byEnd.items.map((x) => x.id)).toEqual([early, mid, late]);
      expect(byEnd.items.map((x) => x.groupName)).toEqual(['Alfa', 'Beta', 'Beta']);
      expect((await page('&sort=amount')).items.map((x) => x.id)).toEqual([mid, early, late]);
      // A search covers notes and documents too, never another client's.
      const found = await page('&q=servis');
      expect(new Set(found.items.map((x) => x.id))).toEqual(new Set([mid, memo]));
      const onlyA = (
        await get(`/api/finance/contracts?clients=${a}&q=servis`, finance.cookie)
      ).json() as ContractsPage;
      expect(onlyA.items.map((x) => x.id)).toEqual([memo]);
    });

    it('pages 30 at a time', async () => {
      const a = await newGroup('Many');
      for (let n = 0; n < 32; n++) {
        await contract(a, 1000 + n, `2026-01-${String((n % 28) + 1).padStart(2, '0')}`);
      }
      const first = (
        await get(`/api/finance/contracts?clients=${a}`, finance.cookie)
      ).json() as ContractsPage;
      expect(first.items).toHaveLength(30);
      const second = (
        await get(`/api/finance/contracts?clients=${a}&after=${first.nextCursor!}`, finance.cookie)
      ).json() as ContractsPage;
      expect(second.items).toHaveLength(2);
      expect(second.nextCursor).toBeNull();
      expect(new Set([...first.items, ...second.items].map((x) => x.id)).size).toBe(32);
    });
  });

  it('the paid ranking route takes the year, month and clients', async () => {
    const a = await newGroup('Route');
    await contract(a, 250_000, '2024-03-05');
    const res = await get(
      `/api/finance/rankings/paid?year=2024&month=3&clients=${a}`,
      finance.cookie,
    );
    expect(res.statusCode).toBe(200);
    const page = res.json() as PaidRankingPage;
    expect(page.rows.map((r) => [r.groupId, r.amountMinor, r.rank])).toEqual([[a, 250_000, 1]]);
  });
  describe('the page period (follow-up of part D)', () => {
    const now = new Date('2026-10-17T10:00:00Z');

    it('the paid ranking takes a month range across years, or all time up to today', async () => {
      const a = await newGroup('Alfa');
      const b = await newGroup('Beta');
      await contract(a, 100_000, '2025-11-10');
      await contract(a, 200_000, '2026-02-01');
      await contract(b, 50_000, '2020-01-01');
      await contract(b, 70_000, '2026-10-18'); // tomorrow: not paid yet
      const scope = { kind: 'groups' as const, groupIds: [a, b] };
      const winter = await paidRanking(
        db(),
        scope,
        { range: { from: '2025-11', to: '2026-02' }, currency: 'EUR' },
        now,
      );
      expect(winter.rows.map((r) => [r.groupName, r.amountMinor])).toEqual([['Alfa', 300_000]]);
      const ever = await paidRanking(db(), scope, { range: null, currency: 'EUR' }, now);
      expect(ever.rows.map((r) => [r.groupName, r.amountMinor])).toEqual([
        ['Alfa', 300_000],
        ['Beta', 50_000],
      ]);

      const route = (query: string) =>
        get(`/api/finance/rankings/paid?clients=${a}${query}`, finance.cookie);
      const ranged = await route('&from=2026-01&to=2026-03');
      expect(ranged.statusCode).toBe(200);
      expect((ranged.json() as PaidRankingPage).rows.map((r) => r.amountMinor)).toEqual([200_000]);
      const allTime = await route('');
      expect((allTime.json() as PaidRankingPage).rows.map((r) => r.amountMinor)).toEqual([300_000]);
    });

    it('the hours ranking takes all time when no months are given', async () => {
      const a = await newGroup('Alfa');
      const admin = await newAdmin('Ever');
      await entry({ groupId: a, userId: admin, minutes: 30, workedOn: '2019-04-01' });
      await entry({ groupId: a, userId: admin, minutes: 15, workedOn: '2026-04-01' });
      const scope = { kind: 'groups' as const, groupIds: [a] };
      const ever = await hoursRanking(db(), scope, { range: null, sort: 'hours' });
      expect(ever.rows.map((r) => r.minutes)).toEqual([45]);
      const res = await get(`/api/finance/rankings/hours?clients=${a}`, finance.cookie);
      expect(res.statusCode).toBe(200);
      expect((res.json() as HoursRankingPage).rows.map((r) => r.minutes)).toEqual([45]);
    });

    it('the contracts table keeps the contracts that run in the period; a search ignores it', async () => {
      const a = await newGroup('Alfa');
      const early = await contract(a, 300_000, '2025-01-01', { endsOn: '2025-12-31' });
      const spanning = await contract(a, 900_000, '2025-06-01', {
        endsOn: '2026-11-30',
        title: 'Servis zmluva',
      });
      const late = await contract(a, 100_000, '2026-06-01', { endsOn: '2027-05-31' });
      const memo = await note(a, 'Servis poznamka');
      const page = async (query: string) =>
        (
          await get(`/api/finance/contracts?clients=${a}${query}`, finance.cookie)
        ).json() as ContractsPage;
      expect((await page('&from=2026-01&to=2026-03')).items.map((x) => x.id)).toEqual([spanning]);
      expect((await page('&from=2025-12&to=2026-06')).items.map((x) => x.id)).toEqual([
        late,
        spanning,
        early,
      ]);
      expect((await page('&from=2027-06&to=2027-12')).items).toEqual([]);
      const found = await page('&from=2027-06&to=2027-12&q=servis');
      expect(new Set(found.items.map((x) => x.id))).toEqual(new Set([spanning, memo]));
    });
  });

  describe('Add time on /finance (follow-up of part D)', () => {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(
      new Date(),
    );
    const post = (payload: object, cookie?: string) =>
      test.app.inject({
        method: 'POST',
        url: '/api/finance/time-entries',
        headers: cookie ? { cookie } : {},
        payload,
      });

    it('answers 401 without a session and 403 to a client and to an admin without the right', async () => {
      const body = { groupId: sharedGroup, userId: plain.id, workedOn: today, minutes: 5 };
      expect((await post(body)).statusCode).toBe(401);
      expect((await post(body, plain.cookie)).statusCode).toBe(403);
      expect((await post(body, client.cookie)).statusCode).toBe(403);
    });

    it('adds a manual entry for a chosen client or without a client', async () => {
      const a = await newGroup('Alfa');
      const withClient = await post(
        { groupId: a, userId: plain.id, workedOn: today, minutes: 90, note: 'Call' },
        finance.cookie,
      );
      expect(withClient.statusCode).toBe(201);
      const without = await post(
        { groupId: null, userId: plain.id, workedOn: today, minutes: 30 },
        finance.cookie,
      );
      expect(without.statusCode).toBe(201);
      const rows = await db()
        .select()
        .from(financeTimeEntries)
        .where(eq(financeTimeEntries.userId, plain.id));
      const byId = new Map(rows.map((r) => [r.id, r]));
      expect(byId.get(withClient.json<{ id: string }>().id)).toMatchObject({
        groupId: a,
        source: 'manual',
        minutes: 90,
        note: 'Call',
        createdBy: finance.id,
      });
      expect(byId.get(without.json<{ id: string }>().id)).toMatchObject({
        groupId: null,
        source: 'manual',
        minutes: 30,
      });
      // The time without a client is in no client's tab, only on the all-clients view.
      const all = await workLogPage(db(), { kind: 'all' }, null, null);
      expect(all.entries.some((x) => x.id === without.json<{ id: string }>().id)).toBe(true);
    });

    it('refuses an unknown client, a missing client field, a client or a future day', async () => {
      const unknown = await post(
        { groupId: randomUUID(), userId: plain.id, workedOn: today, minutes: 5 },
        finance.cookie,
      );
      expect(unknown.statusCode).toBe(404);
      const missing = await post({ userId: plain.id, workedOn: today, minutes: 5 }, finance.cookie);
      expect(missing.json()).toEqual({ error: 'validation_failed' });
      const forClient = await post(
        { groupId: null, userId: client.id, workedOn: today, minutes: 5 },
        finance.cookie,
      );
      expect(forClient.json()).toEqual({ error: 'invalid_assignee' });
      const future = await post(
        { groupId: null, userId: plain.id, workedOn: '2999-01-01', minutes: 5 },
        finance.cookie,
      );
      expect(future.json()).toEqual({ error: 'validation_failed' });
    });

    it('tells the finance room live, with no client for an entry without one', async () => {
      await test.app.listen({ port: 0, host: '127.0.0.1' });
      const address = test.app.server.address();
      if (address === null || typeof address === 'string') throw new Error('no port');
      const socket: Socket = connect(`http://127.0.0.1:${address.port}`, {
        transports: ['websocket'],
        extraHeaders: { cookie: finance.cookie },
        reconnection: false,
      });
      try {
        await new Promise<void>((resolve, reject) => {
          socket.once('connect', () => resolve());
          socket.once('connect_error', reject);
        });
        const got = new Promise((resolve) => socket.once(FinanceEvents.changed, resolve));
        const res = await post(
          { groupId: null, userId: plain.id, workedOn: today, minutes: 10 },
          finance.cookie,
        );
        expect(res.statusCode).toBe(201);
        expect(await got).toEqual({ groupId: null, kind: 'time' });
      } finally {
        socket.close();
      }
    });
  });
});
