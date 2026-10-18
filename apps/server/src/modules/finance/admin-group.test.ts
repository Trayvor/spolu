import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  FinanceItemBodySchema,
  type BoardDto,
  type FinanceOverviewDto,
  type HoursRankingPage,
  type PaidRankingPage,
  type WorkLogPageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { ensureAdminGroup } from '../groups/admin-group.js';
import { addManager } from '../groups/managers.js';
import { createGroup } from '../groups/service.js';
import { ensureBoard } from '../tasks/service.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';
import { createItem } from './documents.js';

/**
 * Finance in the admin group "eGrant tím" (Phase 34 part E, reconciled with Phase 32 E): its
 * Financie tab is the organisation's finance (the expenses and the organisation's own items),
 * not a second store; the time on its tasks is asked and logged as everywhere and stays its
 * own ("internal"); `/finance` leaves it out of "every client" unless chosen and never ranks it.
 * Finance admins only: an admin without the right reads the group but none of its finance.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const RANGE = 'from=2021-01&to=2030-12';

describe('finance in the admin group (Phase 34 part E)', () => {
  let test: TestApp;
  let fin: Session;
  let plain: Session;
  let adminGroup: string;
  let clientGroup: string;
  const admins: string[] = [];

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

  /** A task in the group assigned to `who`, completed, with `minutes` filled. */
  async function doneTask(groupId: string, who: Session, minutes: number) {
    const board = (await call('GET', `/api/groups/${groupId}/board`, who.cookie)).json<BoardDto>();
    const done = board.buckets.find((b) => b.kind === 'done')!.id;
    const created = await call('POST', `/api/groups/${groupId}/tasks`, who.cookie, {
      title: `Úloha ${randomUUID().slice(0, 6)}`,
      description: '',
      assigneeIds: [who.id],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
      bucketId: done,
    });
    expect(created.statusCode, created.body).toBe(201);
    // Time is asked on the admin group's tasks too (decision 13).
    expect(created.json()).toMatchObject({ askTime: true });
    const taskId = created.json<{ id: string }>().id;
    const put = await call('PUT', `/api/tasks/${taskId}/time/me`, who.cookie, { minutes });
    expect(put.statusCode, put.body).toBe(200);
    return taskId;
  }

  const minutesOf = (dto: { byAdmin: { userId: string; minutes: number }[] }, id: string) =>
    dto.byAdmin.find((a) => a.userId === id)?.minutes ?? 0;

  beforeAll(async () => {
    test = await buildTestApp();
    adminGroup = await ensureAdminGroup(test.deps.db);
    await ensureBoard(test.deps.db, adminGroup);
    [fin, plain] = await Promise.all([
      adminSession(true, 'Fin Eva'),
      adminSession(false, 'Plain Ján'),
    ]);
    clientGroup = (
      await createGroup(test.deps.db, {
        name: `Obec ${randomUUID().slice(0, 6)}`,
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      })
    ).id;
    await addManager(test.deps.db, clientGroup, fin.id);
    // 90 minutes of internal work, 30 for the client.
    await doneTask(adminGroup, fin, 90);
    await doneTask(clientGroup, fin, 30);
    const expense = await call('POST', '/api/finance/org/items', fin.cookie, {
      type: 'expense',
      expenseKind: 'other',
      title: 'Server',
      body: '',
      amount: { amountMinor: 12_345, currency: 'EUR' },
      spentOn: '2021-03-15',
      fileIds: [],
    });
    expect(expense.statusCode, expense.body).toBe(201);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  describe('leaks', () => {
    it('an admin without the right reads the group but gets 403 from every finance route of it', async () => {
      expect((await call('GET', `/api/groups/${adminGroup}`, plain.cookie)).statusCode).toBe(200);
      const routes: [string, string, object?][] = [
        ['GET', `/api/groups/${adminGroup}/finance/overview?${RANGE}`],
        ['GET', `/api/groups/${adminGroup}/finance/work-log`],
        ['GET', `/api/groups/${adminGroup}/finance/items`],
        ['GET', `/api/groups/${adminGroup}/finance/folders`],
        ['POST', `/api/groups/${adminGroup}/finance/items`, { type: 'note', title: 'x' }],
        ['POST', `/api/groups/${adminGroup}/finance/time-entries`, {}],
        ['GET', `/api/finance/org/items`],
        ['GET', `/api/finance/overview?internal=1&${RANGE}`],
        ['GET', `/api/finance/work-log?clients=${adminGroup}`],
      ];
      for (const [method, path, body] of routes) {
        const res = await call(method, path, plain.cookie, body);
        expect(res.statusCode, `${method} ${path}`).toBe(403);
        expect(res.body).not.toContain('12345');
      }
    });
  });

  describe('the tab is the organisation', () => {
    it('its overview carries the organisation’s expenses and the internal hours', async () => {
      const res = await call(
        'GET',
        `/api/groups/${adminGroup}/finance/overview?${RANGE}`,
        fin.cookie,
      );
      expect(res.statusCode, res.body).toBe(200);
      const dto = res.json<FinanceOverviewDto>();
      expect(dto.organisation).toBe(true);
      expect(dto.expenses[0]?.paidOut).toBeGreaterThanOrEqual(12_345);
      expect(minutesOf(dto.hours, fin.id)).toBe(90);
      // A client's tab keeps no expenses (decision O3).
      const client = (
        await call('GET', `/api/groups/${clientGroup}/finance/overview?${RANGE}`, fin.cookie)
      ).json<FinanceOverviewDto>();
      expect(client.organisation).toBe(false);
      expect(client.expenses).toEqual([]);
      expect(minutesOf(client.hours, fin.id)).toBe(30);
    });

    it('its work log is the internal time', async () => {
      const res = await call('GET', `/api/groups/${adminGroup}/finance/work-log`, fin.cookie);
      expect(res.statusCode).toBe(200);
      expect(minutesOf(res.json<WorkLogPageDto>().summary!, fin.id)).toBe(90);
    });

    it('keeps no items, folders or files of its own (one store: the organisation)', async () => {
      const routes: [string, string, object?][] = [
        ['GET', `/api/groups/${adminGroup}/finance/items`],
        ['GET', `/api/groups/${adminGroup}/finance/folders`],
        ['POST', `/api/groups/${adminGroup}/finance/items`, { type: 'note', title: 'x', body: '' }],
        ['POST', `/api/groups/${adminGroup}/finance/folders`, { name: 'x' }],
      ];
      for (const [method, path, body] of routes) {
        const res = await call(method, path, fin.cookie, body);
        expect(res.statusCode, `${method} ${path}`).toBe(409);
        expect(res.json()).toEqual({ error: 'admin_group' });
      }
      const upload = await test.app.inject({
        method: 'POST',
        url: `/api/groups/${adminGroup}/finance/files`,
        headers: {
          cookie: fin.cookie,
          'content-type': 'application/pdf',
          'x-file-name': 'a.pdf',
        },
        payload: Buffer.from('%PDF-1.4'),
      });
      expect(upload.statusCode).toBe(409);
    });

    it('a contract of several clients cannot give the admin group a share', async () => {
      const res = await call('POST', '/api/finance/org/items', fin.cookie, {
        type: 'contract',
        title: 'Grant',
        body: '',
        amount: { amountMinor: 200, currency: 'EUR' },
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        payerName: 'Mikroregión',
        shares: [
          { groupId: clientGroup, amountMinor: 100 },
          { groupId: adminGroup, amountMinor: 100 },
        ],
        fileIds: [],
      });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_group' });
    });
  });

  describe('/finance', () => {
    const overview = async (query: string) => {
      const res = await call('GET', `/api/finance/overview?${RANGE}${query}`, fin.cookie);
      expect(res.statusCode, res.body).toBe(200);
      return res.json<FinanceOverviewDto>();
    };

    it('every client leaves the internal time out; the option or the id brings it in', async () => {
      expect(minutesOf((await overview('')).hours, fin.id)).toBe(30);
      expect(minutesOf((await overview('&internal=1')).hours, fin.id)).toBe(120);
      expect(minutesOf((await overview(`&clients=${adminGroup}`)).hours, fin.id)).toBe(90);
      expect(minutesOf((await overview(`&clients=${clientGroup}&internal=1`)).hours, fin.id)).toBe(
        120,
      );
      // The organisation's expenses still count with every client (Phase 32 E).
      expect((await overview('')).organisation).toBe(true);
      const log = await call('GET', '/api/finance/work-log', fin.cookie);
      expect(minutesOf(log.json<WorkLogPageDto>().summary!, fin.id)).toBe(30);
      const internalLog = await call('GET', '/api/finance/work-log?internal=1', fin.cookie);
      expect(minutesOf(internalLog.json<WorkLogPageDto>().summary!, fin.id)).toBe(120);
    });

    it('the rankings never list the admin group, even when it is chosen', async () => {
      for (const query of ['', '&internal=1', `&clients=${adminGroup},${clientGroup}`]) {
        const res = await call(
          'GET',
          `/api/finance/rankings/hours?admin=${fin.id}${query}`,
          fin.cookie,
        );
        expect(res.statusCode, res.body).toBe(200);
        const ids = res.json<HoursRankingPage>().rows.map((r) => r.groupId);
        expect(ids).toContain(clientGroup);
        expect(ids).not.toContain(adminGroup);
      }
      // A contract left in the admin group from before part E is not ranked either.
      const ownerId = fin.id;
      await createItem(
        test.deps.db,
        ownerId,
        adminGroup,
        FinanceItemBodySchema.parse({
          type: 'contract',
          title: 'Starý',
          body: '',
          amount: { amountMinor: 50_000_000_000, currency: 'EUR' },
          startsOn: '2021-01-01',
          endsOn: '2021-12-31',
          fileIds: [],
        }),
      );
      for (const query of ['', '&internal=1', `&clients=${adminGroup}`]) {
        const res = await call('GET', `/api/finance/rankings/paid?${query}`, fin.cookie);
        expect(res.statusCode, res.body).toBe(200);
        expect(res.json<PaidRankingPage>().rows.map((r) => r.groupId)).not.toContain(adminGroup);
      }
      // The ledger shows it only when chosen.
      const ledger = async (query: string) =>
        (await call('GET', `/api/finance/contracts?q=Star%C3%BD${query}`, fin.cookie)).json<{
          items: { groupId: string | null }[];
        }>().items;
      expect((await ledger('')).map((i) => i.groupId)).not.toContain(adminGroup);
      expect((await ledger('&internal=1')).map((i) => i.groupId)).toContain(adminGroup);
    });
  });
});
