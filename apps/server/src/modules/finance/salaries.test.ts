import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  FileInfo,
  FinanceItemDetail,
  FinanceOverviewDto,
  SalaryDetail,
  SalaryPage,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { files } from '../files/schema.js';
import { createGroup } from '../groups/service.js';
import { createUnverifiedClient, addAdmin, deactivateUser } from '../users/service.js';
import { setFinanceAccess } from '../users/service.js';

/**
 * Salaries ("Mzdy", owner request of 2026-10-21, ADR 0065): their own records of an admin, a
 * month and an amount, with files and linked finance documents; finance admins only (anyone
 * else gets 404, an admin even for their own salary); counted as money out on `/finance` where
 * the salary expenses were; every change in the audit log. Months in 2013 (paid out) and 2043
 * (planned), which no other test uses, so the totals here are this file's own.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

describe('salaries (2026-10-21)', () => {
  let test: TestApp;
  let fin: Session;
  let plain: Session;
  let client: Session;
  const admins: string[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    cookie = fin.cookie,
    payload?: object,
  ) =>
    test.app.inject({
      method,
      url,
      headers: cookie ? { cookie } : {},
      ...(payload ? { payload } : {}),
    });

  async function adminSession(finance: boolean, name = 'Eva Nováková'): Promise<Session> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name });
    admins.push(admin.id);
    if (finance) await setFinanceAccess(test.deps.db, admin.id, admin.id);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  async function salary(body: object): Promise<SalaryDetail> {
    const res = await call('POST', '/api/finance/salaries', fin.cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<SalaryDetail>();
  }
  async function orgItem(body: object): Promise<FinanceItemDetail> {
    const res = await call('POST', '/api/finance/org/items', fin.cookie, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FinanceItemDetail>();
  }
  const upload = async (cookie = fin.cookie) =>
    (
      await test.app.inject({
        method: 'POST',
        url: '/api/finance/org/files',
        headers: { cookie, 'content-type': 'application/pdf', 'x-file-name': 'paska.pdf' },
        payload: Buffer.from('%PDF-1.4'),
      })
    ).json<FileInfo>();

  beforeAll(async () => {
    test = await buildTestApp();
    fin = await adminSession(true, 'Fero Financ');
    plain = await adminSession(false, 'Peter Bez Práva');
    const c = await createUnverifiedClient(test.deps.db, newEmail());
    client = { id: c.id, cookie: await loginAs(test.app, c.email) };
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.close();
  });

  describe('permissions', () => {
    it('anyone without the finance right gets 404 from every salary route, even the payee', async () => {
      // The salary pays `plain`, who has no finance right: they still see nothing of it.
      const own = await salary({ payeeId: plain.id, month: '2013-01', amount: eur(100_000) });
      const document = await orgItem({ type: 'document', title: 'Páska' });
      const expense = await orgItem({
        type: 'expense',
        title: 'Server',
        amount: eur(4900),
        spentOn: '2013-01-15',
      });
      const routes: [method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: object][] = [
        ['GET', '/api/finance/salaries'],
        ['GET', `/api/finance/salaries?admin=${plain.id}`],
        ['GET', `/api/finance/salaries/${own.id}`],
        ['POST', '/api/finance/salaries', { payeeId: plain.id, month: '2013-02', amount: eur(1) }],
        ['PATCH', `/api/finance/salaries/${own.id}`, { updatedAt: own.updatedAt, note: 'x' }],
        ['DELETE', `/api/finance/salaries/${own.id}`],
        ['POST', `/api/finance/salaries/${own.id}/documents`, { documentId: document.id }],
        ['DELETE', `/api/finance/salaries/${own.id}/documents/${document.id}`],
        ['POST', `/api/finance/expenses/${expense.id}/documents`, { documentId: document.id }],
        ['DELETE', `/api/finance/expenses/${expense.id}/documents/${document.id}`],
      ];
      for (const who of [plain, client]) {
        for (const [method, path, body] of routes) {
          const res = await call(method, path, who.cookie, body);
          expect({ who: who.id, method, path, code: res.statusCode }).toEqual({
            who: who.id,
            method,
            path,
            code: 404,
          });
          expect(res.body).not.toContain('100000');
        }
      }
      for (const [method, path, body] of routes) {
        expect((await call(method, path, '', body)).statusCode).toBe(401);
      }
      // Nothing changed: the salary is still there, unlinked.
      const still = (await call('GET', `/api/finance/salaries/${own.id}`)).json<SalaryDetail>();
      expect(still).toMatchObject({ note: '', documents: [] });
    });

    it("a salary's files open for finance admins only", async () => {
      const file = await upload();
      const s = await salary({
        payeeId: fin.id,
        month: '2013-02',
        amount: eur(1),
        fileIds: [file.id],
      });
      expect(s.files.map((f) => f.id)).toEqual([file.id]);
      expect((await call('GET', `/api/files/${file.id}`)).statusCode).toBe(200);
      for (const who of [plain, client]) {
        expect((await call('GET', `/api/files/${file.id}`, who.cookie)).statusCode).toBe(404);
      }
      // An attached file cannot go to another salary or item, nor a file of a client.
      const again = await call('POST', '/api/finance/salaries', fin.cookie, {
        payeeId: fin.id,
        month: '2013-03',
        amount: eur(1),
        fileIds: [file.id],
      });
      expect(again.json()).toEqual({ error: 'invalid_attachment' });
    });
  });

  describe('create, read, change, delete', () => {
    it('keeps the admin, month, amount in cents and note; refuses a non-admin payee', async () => {
      const s = await salary({
        payeeId: fin.id,
        month: '2013-04',
        amount: eur(250_050),
        note: 'September s prémiou',
      });
      expect(s).toMatchObject({
        payeeId: fin.id,
        payeeName: 'Fero Financ',
        month: '2013-04',
        amount: eur(250_050),
        note: 'September s prémiou',
        fileCount: 0,
        documentCount: 0,
        createdBy: fin.id,
        createdByName: 'Fero Financ',
      });
      for (const payeeId of [client.id, randomUUID()]) {
        const res = await call('POST', '/api/finance/salaries', fin.cookie, {
          payeeId,
          month: '2013-04',
          amount: eur(1),
        });
        expect(res.statusCode).toBe(400);
      }
      const gone = await adminSession(false, 'Odídený');
      await deactivateUser(test.deps.db, gone.id);
      const res = await call('POST', '/api/finance/salaries', fin.cookie, {
        payeeId: gone.id,
        month: '2013-04',
        amount: eur(1),
      });
      expect(res.statusCode).toBe(400);
      for (const bad of [eur(-1), eur(1.5), { amountMinor: 1, currency: 'UAH' }]) {
        const r = await call('POST', '/api/finance/salaries', fin.cookie, {
          payeeId: fin.id,
          month: '2013-04',
          amount: bad,
        });
        expect(r.statusCode).toBe(400);
      }
    });

    it('edits with the version it loaded (409 when stale), files swapped, and deletes', async () => {
      const first = await upload();
      const second = await upload();
      const s = await salary({
        payeeId: fin.id,
        month: '2013-05',
        amount: eur(1000),
        fileIds: [first.id],
      });
      const other = await adminSession(false, 'Iná Adminka');
      const edited = await call('PATCH', `/api/finance/salaries/${s.id}`, fin.cookie, {
        updatedAt: s.updatedAt,
        payeeId: other.id,
        month: '2013-06',
        amount: eur(2000),
        note: 'Opravené',
        fileIds: [second.id],
      });
      expect(edited.statusCode, edited.body).toBe(200);
      expect(edited.json<SalaryDetail>()).toMatchObject({
        payeeId: other.id,
        month: '2013-06',
        amount: eur(2000),
        note: 'Opravené',
        files: [expect.objectContaining({ id: second.id })],
      });
      // The dropped file is deleted.
      expect(await test.deps.db.select().from(files).where(eq(files.id, first.id))).toEqual([]);
      const stale = await call('PATCH', `/api/finance/salaries/${s.id}`, fin.cookie, {
        updatedAt: s.updatedAt,
        note: 'Neskoro',
      });
      expect(stale.statusCode).toBe(409);
      expect(stale.json()).toEqual({ error: 'finance_changed' });
      expect((await call('DELETE', `/api/finance/salaries/${s.id}`)).statusCode).toBe(204);
      expect((await call('GET', `/api/finance/salaries/${s.id}`)).statusCode).toBe(404);
      expect((await call('DELETE', `/api/finance/salaries/${s.id}`)).statusCode).toBe(404);
      expect(await test.deps.db.select().from(files).where(eq(files.id, second.id))).toEqual([]);
    });

    it('records created, updated (money, month, person, note as changed) and deleted, finance only', async () => {
      const s = await salary({ payeeId: fin.id, month: '2013-07', amount: eur(1000), note: 'a' });
      await call('PATCH', `/api/finance/salaries/${s.id}`, fin.cookie, {
        updatedAt: s.updatedAt,
        amount: eur(1500),
        month: '2013-08',
        note: 'b',
      });
      await call('DELETE', `/api/finance/salaries/${s.id}`);
      const rows = await auditRowsOf(test.deps.db, s.id);
      expect(rows.map((r) => [r.entityType, r.action, r.category, r.actorUserId])).toEqual([
        ['salary', 'created', 'finance', fin.id],
        ['salary', 'updated', 'finance', fin.id],
        ['salary', 'deleted', 'finance', fin.id],
      ]);
      expect(rows[0]!.entityLabel).toBe('Fero Financ · 2013-07');
      expect(rows[1]!.changes).toEqual({
        amount: { from: { minor: 1000, currency: 'EUR' }, to: { minor: 1500, currency: 'EUR' } },
        month: { from: '2013-07', to: '2013-08' },
        note: { changed: true },
      });
      // A non-finance admin's audit log never shows them.
      const seen = (await call('GET', `/api/audit?entityType=salary`, plain.cookie)).json<{
        items?: { entityId: string }[];
      }>();
      expect(JSON.stringify(seen)).not.toContain(s.id);
    });
  });

  describe('list, filters and totals', () => {
    it('filters by admin and month range, newest month first, with totals per admin and month', async () => {
      const eva = await adminSession(false, 'Eva Mzdová');
      const jan = await adminSession(false, 'Ján Mzdový');
      const made = [
        await salary({ payeeId: eva.id, month: '2013-09', amount: eur(100_000) }),
        await salary({ payeeId: eva.id, month: '2013-10', amount: eur(110_000) }),
        await salary({ payeeId: jan.id, month: '2013-10', amount: eur(90_000) }),
        await salary({ payeeId: jan.id, month: '2013-11', amount: eur(0) }),
      ];
      const page = (
        await call('GET', '/api/finance/salaries?from=2013-09&to=2013-11')
      ).json<SalaryPage>();
      const mine = page.items.filter((i) => made.some((m) => m.id === i.id));
      expect(mine.map((i) => [i.payeeName, i.month])).toEqual([
        ['Ján Mzdový', '2013-11'],
        expect.arrayContaining([expect.any(String), '2013-10']),
        expect.arrayContaining([expect.any(String), '2013-10']),
        ['Eva Mzdová', '2013-09'],
      ]);
      expect(page.totals!.byAdmin.filter((a) => [eva.id, jan.id].includes(a.payeeId))).toEqual([
        { payeeId: eva.id, payeeName: 'Eva Mzdová', amount: eur(210_000), count: 2 },
        { payeeId: jan.id, payeeName: 'Ján Mzdový', amount: eur(90_000), count: 2 },
      ]);
      const evaOnly = (
        await call('GET', `/api/finance/salaries?admin=${eva.id}&from=2013-10&to=2013-12`)
      ).json<SalaryPage>();
      expect(evaOnly.items.map((i) => i.month)).toEqual(['2013-10']);
      expect(evaOnly.totals).toEqual({
        total: [{ ...eur(110_000), count: 1 }],
        byAdmin: [{ payeeId: eva.id, payeeName: 'Eva Mzdová', amount: eur(110_000), count: 1 }],
        byMonth: [{ month: '2013-10', amount: eur(110_000) }],
      });
      for (const bad of ['from=2013-10', 'from=2013-12&to=2013-01', 'admin=x%20y', 'after=@@']) {
        expect((await call('GET', `/api/finance/salaries?${bad}`)).statusCode).toBe(400);
      }
    });

    it('pages with the cursor, totals on the first page only', async () => {
      const pager = await adminSession(false, 'Stránkovaný');
      for (let m = 1; m <= 12; m++) {
        await salary({
          payeeId: pager.id,
          month: `2012-${String(m).padStart(2, '0')}`,
          amount: eur(m),
        });
      }
      for (let y = 2008; y <= 2011; y++) {
        for (let m = 1; m <= 12; m++) {
          await salary({
            payeeId: pager.id,
            month: `${y}-${String(m).padStart(2, '0')}`,
            amount: eur(1),
          });
        }
      }
      const first = (
        await call('GET', `/api/finance/salaries?admin=${pager.id}`)
      ).json<SalaryPage>();
      expect(first.items).toHaveLength(50);
      expect(first.items[0]!.month).toBe('2012-12');
      expect(first.totals!.total).toEqual([{ ...eur(78 + 48), count: 60 }]);
      const second = (
        await call('GET', `/api/finance/salaries?admin=${pager.id}&after=${first.nextCursor}`)
      ).json<SalaryPage>();
      expect(second.items).toHaveLength(10);
      expect(second.nextCursor).toBeNull();
      expect(second.totals).toBeNull();
      expect(second.items.at(-1)!.month).toBe('2008-01');
    });
  });

  describe('money out on /finance', () => {
    it('counts salaries as paid out (with "of which salaries") and future months as planned', async () => {
      // The test database outlives a run: compare with what was there before.
      const overview = async (range: string, clients = '') =>
        (await call('GET', `/api/finance/overview?${range}${clients}`)).json<FinanceOverviewDto>();
      const eurOf = (o: FinanceOverviewDto) =>
        o.expenses.find((e) => e.currency === 'EUR') ?? {
          paidOut: 0,
          salaryPaidOut: 0,
          planned: 0,
          byMonth: [],
        };
      const month = (o: FinanceOverviewDto, m: string) =>
        eurOf(o).byMonth.find((b) => b.month === m) ?? { paidOut: 0, planned: 0 };
      const pastRange = 'from=2014-01&to=2014-12';
      const futureRange = 'from=2044-01&to=2044-12';
      const [pastBefore, futureBefore] = [await overview(pastRange), await overview(futureRange)];

      const payee = await adminSession(false, 'Peňažná');
      await salary({ payeeId: payee.id, month: '2014-03', amount: eur(200_000) });
      await salary({ payeeId: payee.id, month: '2044-03', amount: eur(300_000) });
      await orgItem({
        type: 'expense',
        title: 'Pokuta',
        amount: eur(5_000),
        spentOn: '2014-03-10',
      });
      const past = await overview(pastRange);
      expect(past.organisation).toBe(true);
      expect({
        paidOut: eurOf(past).paidOut - eurOf(pastBefore).paidOut,
        salaryPaidOut: eurOf(past).salaryPaidOut - eurOf(pastBefore).salaryPaidOut,
        planned: eurOf(past).planned - eurOf(pastBefore).planned,
        march: month(past, '2014-03').paidOut - month(pastBefore, '2014-03').paidOut,
      }).toEqual({ paidOut: 205_000, salaryPaidOut: 200_000, planned: 0, march: 205_000 });
      const future = await overview(futureRange);
      expect({
        paidOut: eurOf(future).paidOut - eurOf(futureBefore).paidOut,
        salaryPaidOut: eurOf(future).salaryPaidOut - eurOf(futureBefore).salaryPaidOut,
        planned: eurOf(future).planned - eurOf(futureBefore).planned,
        march: month(future, '2044-03').planned - month(futureBefore, '2044-03').planned,
      }).toEqual({ paidOut: 0, salaryPaidOut: 0, planned: 300_000, march: 300_000 });
      // Chosen clients: no money out at all.
      const g = await createGroup(test.deps.db, {
        name: 'Klient',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
      const chosen = await overview(pastRange, `&clients=${g.id}`);
      expect(chosen.organisation).toBe(false);
      expect(chosen.expenses).toEqual([]);
    });
  });

  describe('linked documents', () => {
    it('links a document to a salary and to an expense, both ways, once, and unlinks', async () => {
      const document = await orgItem({ type: 'document', title: 'Výplatná páska 2013' });
      const note = await orgItem({ type: 'note', title: 'Poznámka' });
      const expense = await orgItem({
        type: 'expense',
        title: 'Odvody',
        amount: eur(30_000),
        spentOn: '2013-12-15',
      });
      const s = await salary({ payeeId: fin.id, month: '2013-12', amount: eur(1) });
      const link = (path: string, documentId: string) =>
        call('POST', path, fin.cookie, { documentId });
      expect((await link(`/api/finance/salaries/${s.id}/documents`, document.id)).statusCode).toBe(
        201,
      );
      expect((await link(`/api/finance/salaries/${s.id}/documents`, document.id)).statusCode).toBe(
        200,
      );
      expect(
        (await link(`/api/finance/expenses/${expense.id}/documents`, document.id)).statusCode,
      ).toBe(201);
      // Only a document links; only to a salary or an expense.
      expect((await link(`/api/finance/salaries/${s.id}/documents`, note.id)).statusCode).toBe(400);
      expect(
        (await link(`/api/finance/expenses/${note.id}/documents`, document.id)).statusCode,
      ).toBe(404);
      expect(
        (await link(`/api/finance/salaries/${randomUUID()}/documents`, document.id)).statusCode,
      ).toBe(404);
      expect((await link(`/api/finance/salaries/${s.id}/documents`, randomUUID())).statusCode).toBe(
        404,
      );

      const detail = (await call('GET', `/api/finance/salaries/${s.id}`)).json<SalaryDetail>();
      expect(detail.documents).toEqual([
        { id: document.id, title: 'Výplatná páska 2013', groupId: null, groupName: null },
      ]);
      expect(detail.documentCount).toBe(1);
      const exp = (await call('GET', `/api/finance/items/${expense.id}`)).json<FinanceItemDetail>();
      expect(exp.costDocuments).toEqual(detail.documents);
      const doc = (
        await call('GET', `/api/finance/items/${document.id}`)
      ).json<FinanceItemDetail>();
      expect(doc.linkedCosts).toEqual([
        { kind: 'salary', id: s.id, label: 'Fero Financ · 2013-12' },
        { kind: 'expense', id: expense.id, label: 'Odvody' },
      ]);

      const unlinked = await call(
        'DELETE',
        `/api/finance/salaries/${s.id}/documents/${document.id}`,
      );
      expect(unlinked.statusCode).toBe(204);
      expect(
        (await call('DELETE', `/api/finance/salaries/${s.id}/documents/${document.id}`)).statusCode,
      ).toBe(404);
      const salaryRows = await auditRowsOf(test.deps.db, s.id);
      expect(salaryRows.map((r) => [r.action, r.changes])).toEqual([
        ['created', expect.anything()],
        [
          'updated',
          {
            documents: { added: [{ id: document.id, label: 'Výplatná páska 2013' }], removed: [] },
          },
        ],
        [
          'updated',
          {
            documents: { added: [], removed: [{ id: document.id, label: 'Výplatná páska 2013' }] },
          },
        ],
      ]);
      const expenseRows = await auditRowsOf(test.deps.db, expense.id);
      expect(expenseRows.at(-1)).toMatchObject({
        entityType: 'finance_item',
        action: 'updated',
        changes: {
          documents: { added: [{ id: document.id, label: 'Výplatná páska 2013' }], removed: [] },
        },
      });
      // The document's delete takes its links.
      expect((await call('DELETE', `/api/finance/items/${document.id}`)).statusCode).toBe(204);
      const after = (
        await call('GET', `/api/finance/items/${expense.id}`)
      ).json<FinanceItemDetail>();
      expect(after.costDocuments).toEqual([]);
    });
  });

  describe('expenses without a salary kind', () => {
    it('refuses a salary expense and a payee; an expense needs its title', async () => {
      for (const body of [
        {
          type: 'expense',
          expenseKind: 'salary',
          payeeId: fin.id,
          amount: eur(1),
          spentOn: '2013-01-01',
        },
        { type: 'expense', title: 'X', payeeId: fin.id, amount: eur(1), spentOn: '2013-01-01' },
        { type: 'expense', amount: eur(1), spentOn: '2013-01-01' },
      ]) {
        expect((await call('POST', '/api/finance/org/items', fin.cookie, body)).statusCode).toBe(
          400,
        );
      }
      const e = await orgItem({
        type: 'expense',
        title: 'Nájom',
        amount: eur(1),
        spentOn: '2013-01-01',
      });
      expect(e.expense).toEqual({ kind: 'other', amount: eur(1), spentOn: '2013-01-01' });
      const patch = await call('PATCH', `/api/finance/items/${e.id}`, fin.cookie, {
        updatedAt: e.updatedAt,
        payeeId: fin.id,
      });
      expect(patch.statusCode).toBe(400);
    });
  });
});
