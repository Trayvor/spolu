import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  ContractsPage,
  FileInfo,
  FinanceFolder,
  FinanceItemDetail,
  FinanceItemPage,
  FinanceOverviewDto,
  FinancePerson,
  PaidRankingPage,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createGroup } from '../groups/service.js';
import { reminderSets } from '../reminders/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';
import { financeContractShares } from './schema.js';

/**
 * Phase 32 E (spec 2026-10-18): the organisation's items on `/finance` — expenses, documents,
 * notes, folders and files without a client — and contracts of several clients with a payer and
 * shares that add up (O1), each client's tab showing its own share only (E10), the money and the
 * paid ranking split by the shares (E11, O7), the expenses as money out on `/finance` (O3, E17).
 * Dates are in 2011 (paid, paid out) and 2041 (planned), months no other test uses, so the
 * every-client totals of this file are its own.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

describe('finance at organisation level (Phase 32 E)', () => {
  let test: TestApp;
  let fin: Session;
  let other: Session;
  const admins: string[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    cookie = fin.cookie,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminSession(finance: boolean, name = 'Eva Nováková'): Promise<Session> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name });
    admins.push(admin.id);
    if (finance) await setFinanceAccess(test.deps.db, admin.id, admin.id);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  const newGroup = (name = `Obec ${randomUUID().slice(0, 6)}`) =>
    createGroup(test.deps.db, {
      name,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
  async function orgItem(body: object): Promise<FinanceItemDetail> {
    const res = await call('POST', '/api/finance/org/items', fin.cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FinanceItemDetail>();
  }
  /** An expense (no salary kind since 2026-10-21: salaries are their own records). */
  const expense = (extra: object = {}) => ({
    type: 'expense',
    title: 'Server Hetzner',
    amount: eur(250_000),
    spentOn: '2011-03-31',
    ...extra,
  });
  const shared = (shares: { groupId: string; amountMinor: number }[], extra: object = {}) => ({
    type: 'contract',
    title: `Spoločný grant ${randomUUID().slice(0, 6)}`,
    amount: eur(shares.reduce((a, s) => a + s.amountMinor, 0)),
    startsOn: '2011-02-01',
    endsOn: '2011-12-31',
    payerName: 'Mikroregión Horehronie',
    shares,
    ...extra,
  });

  beforeAll(async () => {
    test = await buildTestApp();
    [fin, other] = await Promise.all([adminSession(true), adminSession(false, 'Ján Kováč')]);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  describe('expenses', () => {
    it('an expense says what it is, of the kind "other", without a payee', async () => {
      const item = await orgItem(expense());
      expect(item).toMatchObject({
        groupId: null,
        type: 'expense',
        title: 'Server Hetzner',
        contract: null,
        expense: { kind: 'other', amount: eur(250_000), spentOn: '2011-03-31' },
      });
      expect(item.expense).not.toHaveProperty('payeeId');
    });

    it('refuses the salary kind and a payee: salaries are their own records (2026-10-21)', async () => {
      for (const body of [
        expense({ expenseKind: 'salary', payeeId: other.id }),
        expense({ expenseKind: 'salary' }),
        expense({ payeeId: other.id }),
        expense({ title: '' }),
      ]) {
        const res = await call('POST', '/api/finance/org/items', fin.cookie, body);
        expect({ body, code: res.statusCode }).toEqual({ body, code: 400 });
      }
    });

    it('cannot be made for a client (an expense belongs to the organisation)', async () => {
      const g = await newGroup();
      const res = await call('POST', `/api/groups/${g.id}/finance/items`, fin.cookie, expense());
      expect(res.statusCode).toBe(400);
    });

    it('an edit changes the amount, the date and the title; never contract fields, a payee or the kind', async () => {
      const item = await orgItem(expense());
      const ok = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
        updatedAt: item.updatedAt,
        amount: eur(260_000),
        spentOn: '2011-04-30',
        title: 'Apríl',
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const saved = ok.json<FinanceItemDetail>();
      expect(saved.title).toBe('Apríl');
      expect(saved.expense).toMatchObject({ amount: eur(260_000), spentOn: '2011-04-30' });
      for (const patch of [
        { startsOn: '2011-01-01' },
        { contractNumber: 'X' },
        { payerName: 'Obec' },
        { payeeId: fin.id },
        { expenseKind: 'other' },
      ]) {
        const res = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
          updatedAt: saved.updatedAt,
          ...patch,
        });
        expect({ patch, code: res.statusCode }).toEqual({ patch, code: 400 });
      }
      // Another expense keeps its title and has no payee.
      const bill = await orgItem({
        type: 'expense',
        expenseKind: 'other',
        title: 'Pokuta',
        amount: eur(10_000),
        spentOn: '2011-05-01',
      });
      for (const patch of [{ title: '' }, { payeeId: fin.id }]) {
        const res = await call('PATCH', `/api/finance/items/${bill.id}`, fin.cookie, {
          updatedAt: bill.updatedAt,
          ...patch,
        });
        expect({ patch, code: res.statusCode }).toEqual({ patch, code: 400 });
      }
    });

    it('keeps reminders of its own, without a client', async () => {
      const item = await orgItem(expense({ spentOn: '2041-01-31' }));
      const res = await call('PUT', `/api/finance-items/${item.id}/reminders`, fin.cookie, {
        times: [{ at: new Date(Date.now() + 3 * 86_400_000).toISOString() }],
      });
      expect(res.statusCode, res.body).toBe(200);
      const [set] = await test.deps.db
        .select()
        .from(reminderSets)
        .where(eq(reminderSets.financeItemId, item.id));
      expect(set?.groupId).toBeNull();
      // Only finance admins can be its recipients.
      const bad = await call('PUT', `/api/finance-items/${item.id}/reminders`, fin.cookie, {
        times: [{ at: new Date(Date.now() + 4 * 86_400_000).toISOString() }],
        recipientIds: [other.id],
      });
      expect(bad.json()).toEqual({ error: 'invalid_recipient' });
    });

    it('the payee picker (of salaries) lists the active admins and the superadmin, never a client', async () => {
      const res = await call('GET', '/api/finance/payees');
      expect(res.statusCode).toBe(200);
      const ids = res.json<FinancePerson[]>().map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining([fin.id, other.id]));
      const roles = await test.deps.db.select({ id: user.id, role: user.role }).from(user);
      const clientIds = new Set(roles.filter((r) => r.role === 'client').map((r) => r.id));
      expect(ids.some((id) => clientIds.has(id))).toBe(false);
    });
  });

  describe('documents, notes, folders and files of the organisation', () => {
    it('live in folders of their own, apart from any client', async () => {
      const folder = (
        await call('POST', '/api/finance/org/folders', fin.cookie, { name: 'Účtovníctvo' })
      ).json<FinanceFolder>();
      expect(folder.groupId).toBeNull();
      const note = await orgItem({ type: 'note', title: 'Poznámka', folderId: folder.id });
      expect(note).toMatchObject({ groupId: null, folderId: folder.id });
      const page = (
        await call('GET', `/api/finance/org/items?folder=${folder.id}`)
      ).json<FinanceItemPage>();
      expect(page.items.map((i) => i.id)).toEqual([note.id]);
      expect(
        (await call('GET', '/api/finance/org/folders')).json<FinanceFolder[]>().map((f) => f.id),
      ).toContain(folder.id);

      // A client's folder is not the organisation's, nor the other way round (404).
      const g = await newGroup();
      const clientFolder = (
        await call('POST', `/api/groups/${g.id}/finance/folders`, fin.cookie, { name: 'Zmluvy' })
      ).json<FinanceFolder>();
      const wrong = await call('POST', '/api/finance/org/items', fin.cookie, {
        type: 'note',
        title: 'X',
        folderId: clientFolder.id,
      });
      expect(wrong.statusCode).toBe(404);
      const back = await call('POST', `/api/groups/${g.id}/finance/items`, fin.cookie, {
        type: 'note',
        title: 'X',
        folderId: folder.id,
      });
      expect(back.statusCode).toBe(404);
      // The client's tab never lists the organisation's note.
      const tab = (await call('GET', `/api/groups/${g.id}/finance/items`)).json<FinanceItemPage>();
      expect(tab.items.some((i) => i.id === note.id)).toBe(false);
    });

    it("attaches the organisation's finance files only, never a client's", async () => {
      const upload = (url: string) =>
        test.app.inject({
          method: 'POST',
          url,
          headers: {
            cookie: fin.cookie,
            'content-type': 'application/pdf',
            'x-file-name': 'f.pdf',
          },
          payload: Buffer.from('%PDF-1.4'),
        });
      const orgFile = (await upload('/api/finance/org/files')).json<FileInfo>();
      const g = await newGroup();
      const clientFile = (await upload(`/api/groups/${g.id}/finance/files`)).json<FileInfo>();
      const note = await orgItem({ type: 'note', title: 'S prílohou', fileIds: [orgFile.id] });
      expect(note.files.map((f) => f.id)).toEqual([orgFile.id]);
      const res = await call('POST', '/api/finance/org/items', fin.cookie, {
        type: 'note',
        title: 'Cudzia príloha',
        fileIds: [clientFile.id],
      });
      expect(res.json()).toEqual({ error: 'invalid_attachment' });
      const fresh = (await upload('/api/finance/org/files')).json<FileInfo>();
      const toClient = await call('POST', `/api/groups/${g.id}/finance/items`, fin.cookie, {
        type: 'note',
        title: 'X',
        fileIds: [fresh.id],
      });
      expect(toClient.json()).toEqual({ error: 'invalid_attachment' });
      // The organisation's file opens for a finance admin.
      expect((await call('GET', `/api/files/${orgFile.id}`)).statusCode).toBe(200);
    });
  });

  describe('contracts of several clients', () => {
    it('take a payer and shares that add up exactly (O1, E8)', async () => {
      const [g1, g2] = [await newGroup('Obec Alfa'), await newGroup('Obec Beta')];
      const item = await orgItem(
        shared([
          { groupId: g1.id, amountMinor: 100_000 },
          { groupId: g2.id, amountMinor: 200_000 },
        ]),
      );
      expect(item.groupId).toBeNull();
      expect(item.contract).toMatchObject({
        amount: eur(300_000),
        shared: {
          payerName: 'Mikroregión Horehronie',
          total: eur(300_000),
          shares: [
            { groupId: g1.id, groupName: 'Obec Alfa', amountMinor: 100_000 },
            { groupId: g2.id, groupName: 'Obec Beta', amountMinor: 200_000 },
          ],
        },
      });
      const bad = [
        { ...shared([{ groupId: g1.id, amountMinor: 1 }]) },
        {
          ...shared([
            { groupId: g1.id, amountMinor: 100 },
            { groupId: g2.id, amountMinor: 200 },
          ]),
          amount: eur(301),
        },
        shared([
          { groupId: g1.id, amountMinor: 100 },
          { groupId: g1.id, amountMinor: 200 },
        ]),
        shared([
          { groupId: g1.id, amountMinor: 100 },
          { groupId: randomUUID(), amountMinor: 200 },
        ]),
        {
          ...shared([
            { groupId: g1.id, amountMinor: 100 },
            { groupId: g2.id, amountMinor: 200 },
          ]),
          payerName: '',
        },
      ];
      for (const body of bad) {
        const res = await call('POST', '/api/finance/org/items', fin.cookie, body);
        expect({ code: res.statusCode, body: res.body }).toMatchObject({ code: 400 });
      }
    });

    it("show in each client's tab with that client's share and the payer, never the others' (E10)", async () => {
      const [g1, g2, g3] = [
        await newGroup('Obec Gama'),
        await newGroup(`Tajná obec ${randomUUID().slice(0, 6)}`),
        await newGroup(),
      ];
      const item = await orgItem(
        shared([
          { groupId: g1.id, amountMinor: 123_400 },
          { groupId: g2.id, amountMinor: 567_800 },
        ]),
      );
      // A folder of the client holds nothing of it; the top level and the flat lists do.
      const folder = (
        await call('POST', `/api/groups/${g1.id}/finance/folders`, fin.cookie, { name: 'A' })
      ).json<FinanceFolder>();
      for (const url of [
        `/api/groups/${g1.id}/finance/items`,
        `/api/groups/${g1.id}/finance/items?type=contract`,
        `/api/groups/${g1.id}/finance/items?q=Mikroregi`,
        `/api/finance/items/${item.id}?group=${g1.id}`,
      ]) {
        const res = await call('GET', url);
        expect(res.statusCode, url).toBe(200);
        const body = res.json<FinanceItemPage | FinanceItemDetail>();
        const found = 'items' in body ? body.items.find((i) => i.id === item.id) : body;
        expect(found?.contract, url).toMatchObject({
          amount: eur(123_400),
          shared: {
            payerName: 'Mikroregión Horehronie',
            total: eur(691_200),
            shares: [{ groupId: g1.id, amountMinor: 123_400 }],
          },
        });
        // Nothing of the other client: not its id, its name or its share.
        for (const secret of [g2.id, g2.name, '567800']) {
          expect({ url, secret, leak: res.body.includes(secret) }).toEqual({
            url,
            secret,
            leak: false,
          });
        }
      }
      const inFolder = (
        await call('GET', `/api/groups/${g1.id}/finance/items?folder=${folder.id}`)
      ).json<FinanceItemPage>();
      expect(inFolder.items).toEqual([]);
      // A client without a share sees nothing of it.
      expect((await call('GET', `/api/finance/items/${item.id}?group=${g3.id}`)).statusCode).toBe(
        404,
      );
      const g3tab = (
        await call('GET', `/api/groups/${g3.id}/finance/items`)
      ).json<FinanceItemPage>();
      expect(g3tab.items).toEqual([]);
      // `/finance` reads the whole contract.
      const whole = (await call('GET', `/api/finance/items/${item.id}`)).json<FinanceItemDetail>();
      expect(whole.contract?.shared?.shares.map((s) => s.groupId).sort()).toEqual(
        [g1.id, g2.id].sort(),
      );
    });

    it('an edit replaces the shares, which must add up to the (new) amount', async () => {
      const [g1, g2, g3] = [await newGroup(), await newGroup(), await newGroup()];
      const item = await orgItem(
        shared([
          { groupId: g1.id, amountMinor: 1_000 },
          { groupId: g2.id, amountMinor: 2_000 },
        ]),
      );
      const offAmount = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
        updatedAt: item.updatedAt,
        amount: eur(3_500),
      });
      expect(offAmount.statusCode).toBe(400);
      const ok = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
        updatedAt: item.updatedAt,
        amount: eur(3_500),
        payerName: 'VÚC',
        shares: [
          { groupId: g1.id, amountMinor: 500 },
          { groupId: g3.id, amountMinor: 3_000 },
        ],
      });
      expect(ok.statusCode, ok.body).toBe(200);
      const rows = await test.deps.db
        .select()
        .from(financeContractShares)
        .where(eq(financeContractShares.itemId, item.id));
      expect(rows.map((r) => [r.groupId, r.amountMinor]).sort()).toEqual(
        [
          [g1.id, 500],
          [g3.id, 3_000],
        ].sort(),
      );
      // g2 has no share any more: its tab no longer lists it.
      const tab = (await call('GET', `/api/groups/${g2.id}/finance/items`)).json<FinanceItemPage>();
      expect(tab.items.some((i) => i.id === item.id)).toBe(false);
      // A contract of one client has no payer and no shares.
      const single = (
        await call('POST', `/api/groups/${g1.id}/finance/items`, fin.cookie, {
          type: 'contract',
          title: 'Jedna obec',
          amount: eur(100),
          startsOn: '2011-01-01',
          endsOn: '2011-12-31',
        })
      ).json<FinanceItemDetail>();
      expect(single.contract?.shared).toBeNull();
      for (const patch of [
        { payerName: 'X' },
        {
          shares: [
            { groupId: g1.id, amountMinor: 50 },
            { groupId: g2.id, amountMinor: 50 },
          ],
        },
      ]) {
        const res = await call('PATCH', `/api/finance/items/${single.id}`, fin.cookie, {
          updatedAt: single.updatedAt,
          ...patch,
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('a deleted contract takes its shares with it', async () => {
      const [g1, g2] = [await newGroup(), await newGroup()];
      const item = await orgItem(
        shared([
          { groupId: g1.id, amountMinor: 1 },
          { groupId: g2.id, amountMinor: 1 },
        ]),
      );
      expect((await call('DELETE', `/api/finance/items/${item.id}`)).statusCode).toBe(204);
      const rows = await test.deps.db
        .select()
        .from(financeContractShares)
        .where(eq(financeContractShares.itemId, item.id));
      expect(rows).toEqual([]);
    });
  });

  describe('money', () => {
    it("a client's overview and the paid ranking count its share (E11, O7)", async () => {
      const [g1, g2] = [await newGroup(), await newGroup()];
      await orgItem(
        shared([
          { groupId: g1.id, amountMinor: 30_000 },
          { groupId: g2.id, amountMinor: 70_000 },
        ]),
      );
      // g1 also has a contract of its own.
      await call('POST', `/api/groups/${g1.id}/finance/items`, fin.cookie, {
        type: 'contract',
        title: 'Vlastná',
        amount: eur(5_000),
        startsOn: '2011-06-01',
        endsOn: '2011-06-30',
      });
      const overview = (
        await call('GET', `/api/groups/${g1.id}/finance/overview?from=2011-01&to=2011-12`)
      ).json<FinanceOverviewDto>();
      expect(overview.money).toEqual([
        {
          currency: 'EUR',
          paid: 35_000,
          toBePaid: 0,
          byMonth: [
            { month: '2011-02', paid: 30_000, toBePaid: 0 },
            { month: '2011-06', paid: 5_000, toBePaid: 0 },
          ],
        },
      ]);
      expect(overview.organisation).toBe(false);
      expect(overview.expenses).toEqual([]);

      const ranking = (
        await call(
          'GET',
          `/api/finance/rankings/paid?from=2011-01&to=2011-12&clients=${g1.id},${g2.id}`,
        )
      ).json<PaidRankingPage>();
      expect(ranking.rows.map((r) => [r.groupId, r.amountMinor])).toEqual([
        [g2.id, 70_000],
        [g1.id, 35_000],
      ]);
      expect(ranking.total).toBe(105_000);

      const chosen = (
        await call('GET', `/api/finance/overview?from=2011-01&to=2011-12&clients=${g1.id},${g2.id}`)
      ).json<FinanceOverviewDto>();
      expect(chosen.money[0]?.paid).toBe(105_000);
      expect(chosen.organisation).toBe(false);
      expect(chosen.expenses).toEqual([]);
    });

    it('the expenses are money out on /finance with every client only (O3, E6, E17)', async () => {
      const before = (
        await call('GET', '/api/finance/overview?from=2041-01&to=2041-12')
      ).json<FinanceOverviewDto>();
      const pastBefore = (
        await call('GET', '/api/finance/overview?from=2011-01&to=2011-12')
      ).json<FinanceOverviewDto>();
      // A salary (its own record since 2026-10-21) of July 2011, and one planned in May 2041.
      const salary = async (month: string, amountMinor: number) => {
        const res = await call('POST', '/api/finance/salaries', fin.cookie, {
          payeeId: other.id,
          month,
          amount: eur(amountMinor),
        });
        expect(res.statusCode, res.body).toBe(201);
      };
      await salary('2041-05', 111);
      await salary('2011-07', 1_000);
      await orgItem({
        type: 'expense',
        expenseKind: 'other',
        title: 'Doména',
        amount: eur(300),
        spentOn: '2011-07-02',
      });
      const after = (
        await call('GET', '/api/finance/overview?from=2041-01&to=2041-12')
      ).json<FinanceOverviewDto>();
      const pastAfter = (
        await call('GET', '/api/finance/overview?from=2011-01&to=2011-12')
      ).json<FinanceOverviewDto>();
      const eurOf = (o: FinanceOverviewDto) =>
        o.expenses.find((e) => e.currency === 'EUR') ?? {
          paidOut: 0,
          salaryPaidOut: 0,
          planned: 0,
        };
      expect(after.organisation).toBe(true);
      expect(eurOf(after).planned - eurOf(before).planned).toBe(111);
      expect(eurOf(after).paidOut - eurOf(before).paidOut).toBe(0);
      expect(eurOf(pastAfter).paidOut - eurOf(pastBefore).paidOut).toBe(1_300);
      expect(eurOf(pastAfter).salaryPaidOut - eurOf(pastBefore).salaryPaidOut).toBe(1_000);
      // The salary changes no cost of work and no hours (O4).
      expect(pastAfter.cost).toEqual(pastBefore.cost);
      expect(pastAfter.hours.minutes).toBe(pastBefore.hours.minutes);
    });

    it('the ledger filters by type and period, and names the organisation’s items', async () => {
      const [g1, g2] = [await newGroup(), await newGroup()];
      const contract = await orgItem(
        shared([
          { groupId: g1.id, amountMinor: 10 },
          { groupId: g2.id, amountMinor: 20 },
        ]),
      );
      const bill = await orgItem({
        type: 'expense',
        expenseKind: 'other',
        title: `Licencia ${randomUUID().slice(0, 6)}`,
        amount: eur(999),
        spentOn: '2011-08-15',
      });
      const page = async (query: string) =>
        (await call('GET', `/api/finance/contracts?${query}`)).json<ContractsPage>();
      const expenses = await page('type=expense&from=2011-08&to=2011-08');
      expect(expenses.items.map((i) => i.id)).toContain(bill.id);
      expect(expenses.items.every((i) => i.type === 'expense')).toBe(true);
      expect(
        (await page('type=expense&from=2011-09&to=2011-09')).items.map((i) => i.id),
      ).not.toContain(bill.id);
      const row = expenses.items.find((i) => i.id === bill.id)!;
      expect(row).toMatchObject({ groupId: null, groupName: '' });
      // A chosen client sees the contract it shares, never the organisation's expense.
      const ofG1 = await page(`type=all&clients=${g1.id}`);
      expect(ofG1.items.map((i) => i.id)).toEqual([contract.id]);
      expect((await page(`type=expense&clients=${g1.id}`)).items).toEqual([]);
      // The default is contracts, as before part E.
      const contracts = await page(`clients=${g1.id},${g2.id}`);
      expect(contracts.items.map((i) => i.id)).toEqual([contract.id]);
      expect(contracts.items[0]!.contract?.shared?.shares).toHaveLength(2);
    });
  });
});
