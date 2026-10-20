import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  ContractChoice,
  FileInfo,
  FinanceItemDetail,
  FinanceOverviewDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf, pgCode } from '../audit/test-helpers.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';
import { financeContractSchedules, financeItems } from './schema.js';

/**
 * Contracts v2 (owner request of 2026-10-21, ADR 0066): amounts of 0, a master contract one level
 * deep covering its contracts' clients, a payment schedule with its expected payments, documents
 * linked to a contract with the payments they record, the overview's "očakávané", the audit rows
 * and the finance right. Schedules run in 2012 (all due: paid or unpaid) or in 2045 (all coming),
 * so the statuses do not depend on the day the test runs.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string };

const newEmail = () => `${randomUUID()}@example.com`;
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

describe('finance contracts v2', () => {
  let test: TestApp;
  let fin: Session;
  let plain: Session;
  const admins: string[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    payload?: object,
    cookie = fin.cookie,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminSession(finance: boolean): Promise<Session> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name: 'Eva Nováková' });
    admins.push(admin.id);
    if (finance) await setFinanceAccess(test.deps.db, admin.id, admin.id);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  async function clientIn(groupId: string): Promise<Session> {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name: 'Klient', role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }
  const newGroup = () =>
    createGroup(test.deps.db, {
      name: `Obec ${randomUUID().slice(0, 6)}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });

  const contractBody = (extra: object = {}) => ({
    type: 'contract',
    title: `Zmluva ${randomUUID().slice(0, 6)}`,
    amount: eur(720_000),
    startsOn: '2012-01-01',
    endsOn: '2012-12-31',
    ...extra,
  });
  async function clientItem(groupId: string, body: object): Promise<FinanceItemDetail> {
    const res = await call('POST', `/api/groups/${groupId}/finance/items`, body);
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FinanceItemDetail>();
  }
  async function sharedContract(
    shares: { groupId: string; amountMinor: number }[],
    extra: object = {},
  ): Promise<FinanceItemDetail> {
    const res = await call('POST', '/api/finance/org/items', {
      ...contractBody(),
      amount: eur(shares.reduce((s, x) => s + x.amountMinor, 0)),
      payerName: 'Mikroregión Horehronie',
      shares,
      ...extra,
    });
    expect(res.statusCode, res.body).toBe(201);
    return res.json<FinanceItemDetail>();
  }
  async function detail(id: string, group?: string): Promise<FinanceItemDetail> {
    const res = await call('GET', `/api/finance/items/${id}${group ? `?group=${group}` : ''}`);
    expect(res.statusCode, res.body).toBe(200);
    return res.json<FinanceItemDetail>();
  }
  const patch = async (id: string, changes: object) => {
    const current = await detail(id);
    return call('PATCH', `/api/finance/items/${id}`, { ...changes, updatedAt: current.updatedAt });
  };

  beforeAll(async () => {
    test = await buildTestApp();
    [fin, plain] = await Promise.all([adminSession(true), adminSession(false)]);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  describe('an amount of 0', () => {
    it('a contract of one client, its schedule and a document payment may all be 0', async () => {
      const g = await newGroup();
      const c = await clientItem(
        g.id,
        contractBody({
          amount: eur(0),
          schedule: { frequency: 'monthly', amountMinor: 0, startsOn: '2012-01-01' },
        }),
      );
      expect(c.contract?.amount).toEqual(eur(0));
      expect(c.schedule?.amount).toEqual(eur(0));
      const doc = await clientItem(g.id, {
        type: 'document',
        title: 'Výpis',
        contractLink: { contractId: c.id, payment: { amount: eur(0), paidOn: '2012-01-05' } },
      });
      expect(doc.contractLink?.payment?.amount).toEqual(eur(0));
      expect((await patch(c.id, { amount: eur(0), title: 'Bezodplatná' })).statusCode).toBe(200);
    });

    it('a contract of several clients may be 0 with shares of 0', async () => {
      const [a, b] = await Promise.all([newGroup(), newGroup()]);
      const c = await sharedContract([
        { groupId: a.id, amountMinor: 0 },
        { groupId: b.id, amountMinor: 0 },
      ]);
      expect(c.contract?.shared?.total).toEqual(eur(0));
      expect(c.contract?.shared?.shares.map((s) => s.amountMinor)).toEqual([0, 0]);
    });

    it('the database refuses a negative amount anywhere', async () => {
      const g = await newGroup();
      const c = await clientItem(g.id, contractBody());
      const negative = await test.deps.db
        .update(financeItems)
        .set({ amountMinor: -1 })
        .where(eq(financeItems.id, c.id))
        .then(
          () => null,
          (e: unknown) => pgCode(e),
        );
      expect(negative).toBe('23514');
      const schedule = await test.deps.db
        .insert(financeContractSchedules)
        .values({
          itemId: c.id,
          frequency: 'monthly',
          everyMonths: 1,
          amountMinor: -5,
          startsOn: '2012-01-01',
        })
        .then(
          () => null,
          (e: unknown) => pgCode(e),
        );
      expect(schedule).toBe('23514');
    });
  });

  describe('a master contract (one level)', () => {
    it('shows its contracts under it and itself on each of them', async () => {
      const g = await newGroup();
      const master = await clientItem(g.id, contractBody({ title: 'Rámcová zmluva 2012' }));
      const child = await clientItem(
        g.id,
        contractBody({ title: 'Dodatok 1', parentId: master.id }),
      );
      expect(child.contract?.parentId).toBe(master.id);
      expect(child.parent).toMatchObject({ id: master.id, title: 'Rámcová zmluva 2012' });
      const m = await detail(master.id);
      expect(m.children?.map((c) => c.id)).toEqual([child.id]);
      expect(m.parent).toBeNull();
    });

    it('refuses a second level, a master getting a master, itself, and anything but a contract', async () => {
      const g = await newGroup();
      const master = await clientItem(g.id, contractBody());
      const child = await clientItem(g.id, contractBody({ parentId: master.id }));
      const other = await clientItem(g.id, contractBody());
      const doc = await clientItem(g.id, { type: 'document', title: 'Príloha' });
      const deeper = await call(
        'POST',
        `/api/groups/${g.id}/finance/items`,
        contractBody({ parentId: child.id }),
      );
      expect(deeper.statusCode).toBe(400);
      expect(deeper.json()).toEqual({ error: 'invalid_parent' });
      expect((await patch(master.id, { parentId: other.id })).json()).toEqual({
        error: 'invalid_parent',
      });
      expect((await patch(other.id, { parentId: other.id })).statusCode).toBe(400);
      expect((await patch(other.id, { parentId: doc.id })).statusCode).toBe(400);
      // A cycle would need two levels: refused the same way.
      expect((await patch(master.id, { parentId: child.id })).statusCode).toBe(400);
      expect((await patch(other.id, { parentId: master.id })).statusCode).toBe(200);
      expect((await patch(other.id, { parentId: null })).statusCode).toBe(200);
      expect((await detail(other.id)).parent).toBeNull();
      // A master or a parent only on a contract.
      expect((await patch(doc.id, { parentId: master.id })).statusCode).toBe(400);
    });

    it("needs a master that covers the contract's clients", async () => {
      const [a, b, c] = await Promise.all([newGroup(), newGroup(), newGroup()]);
      const ofA = await clientItem(a.id, contractBody());
      const wrong = await call(
        'POST',
        `/api/groups/${b.id}/finance/items`,
        contractBody({ parentId: ofA.id }),
      );
      expect(wrong.json()).toEqual({ error: 'invalid_parent' });
      const master = await sharedContract([
        { groupId: a.id, amountMinor: 100 },
        { groupId: b.id, amountMinor: 100 },
      ]);
      await clientItem(a.id, contractBody({ parentId: master.id }));
      const ofC = await call(
        'POST',
        `/api/groups/${c.id}/finance/items`,
        contractBody({ parentId: master.id }),
      );
      expect(ofC.statusCode).toBe(400);
      // A contract of several clients under a master of several: its clients among the master's.
      const sharedChild = await call('POST', '/api/finance/org/items', {
        ...contractBody(),
        amount: eur(2),
        payerName: 'Mikroregión',
        shares: [
          { groupId: a.id, amountMinor: 1 },
          { groupId: c.id, amountMinor: 1 },
        ],
        parentId: master.id,
      });
      expect(sharedChild.json()).toEqual({ error: 'invalid_parent' });
      // The master cannot drop a client one of its contracts has.
      const drop = await patch(master.id, {
        shares: [
          { groupId: b.id, amountMinor: 100 },
          { groupId: c.id, amountMinor: 100 },
        ],
      });
      expect(drop.json()).toEqual({ error: 'invalid_parent' });
    });

    it("a client's tab lists only that client's contracts under a master of several clients", async () => {
      const [a, b] = await Promise.all([newGroup(), newGroup()]);
      const master = await sharedContract([
        { groupId: a.id, amountMinor: 100 },
        { groupId: b.id, amountMinor: 300 },
      ]);
      const ofA = await clientItem(a.id, contractBody({ parentId: master.id }));
      const ofB = await clientItem(b.id, contractBody({ parentId: master.id }));
      expect((await detail(master.id)).children?.map((c) => c.id).sort()).toEqual(
        [ofA.id, ofB.id].sort(),
      );
      expect((await detail(master.id, a.id)).children?.map((c) => c.id)).toEqual([ofA.id]);
      expect((await detail(ofA.id, a.id)).parent?.id).toBe(master.id);
    });

    it('deleting a master leaves its contracts without one, each with its own audit row', async () => {
      const g = await newGroup();
      const master = await clientItem(g.id, contractBody());
      const child = await clientItem(g.id, contractBody({ parentId: master.id }));
      expect((await call('DELETE', `/api/finance/items/${master.id}`)).statusCode).toBe(204);
      expect((await detail(child.id)).parent).toBeNull();
      const rows = await auditRowsOf(test.deps.db, child.id);
      expect(rows.map((r) => r.action)).toEqual(['created', 'updated']);
      expect(rows[1]!.changes).toMatchObject({ parent: { from: { id: master.id } } });
    });
  });

  describe('a payment schedule', () => {
    it('monthly: the expected payments, each paid by the documents dated in its period', async () => {
      const g = await newGroup();
      const c = await clientItem(
        g.id,
        contractBody({
          schedule: {
            frequency: 'monthly',
            amountMinor: 60_000,
            startsOn: '2012-01-31',
            endsOn: '2012-04-30',
          },
        }),
      );
      expect(c.schedule).toEqual({
        frequency: 'monthly',
        everyMonths: 1,
        amount: eur(60_000),
        startsOn: '2012-01-31',
        endsOn: '2012-04-30',
        dates: null,
      });
      expect(c.payments?.periods.map((p) => p.dueOn)).toEqual([
        '2012-01-31',
        '2012-02-29',
        '2012-03-31',
        '2012-04-30',
      ]);
      const pay = (amountMinor: number, paidOn: string) =>
        clientItem(g.id, {
          type: 'document',
          title: `Faktúra ${paidOn}`,
          contractLink: { contractId: c.id, payment: { amount: eur(amountMinor), paidOn } },
        });
      await pay(60_000, '2012-02-05');
      await pay(30_000, '2012-03-01');
      await pay(30_000, '2012-03-30');
      await pay(10_000, '2012-04-02');
      // A document without a payment is linked but counts nothing.
      await clientItem(g.id, {
        type: 'document',
        title: 'Dodatok',
        contractLink: { contractId: c.id },
      });
      const d = await detail(c.id);
      expect(d.payments?.periods.map((p) => [p.dueOn, p.received.amountMinor, p.status])).toEqual([
        ['2012-01-31', 60_000, 'paid'],
        ['2012-02-29', 60_000, 'paid'],
        ['2012-03-31', 10_000, 'partial'],
        ['2012-04-30', 0, 'unpaid'],
      ]);
      expect(d.payments).toMatchObject({
        dueToDate: eur(240_000),
        received: eur(130_000),
        upcoming: eur(0),
        nextDueOn: null,
        unpaidCount: 1,
        partialCount: 1,
      });
      expect(d.documents).toHaveLength(5);
    });

    it('custom days and every N months; coming payments in the future', async () => {
      const g = await newGroup();
      const c = await clientItem(
        g.id,
        contractBody({
          startsOn: '2045-01-01',
          endsOn: '2045-12-31',
          schedule: { frequency: 'dates', dates: ['2045-06-30', '2045-03-15'], amountMinor: 500 },
        }),
      );
      expect(c.schedule?.dates).toEqual(['2045-03-15', '2045-06-30']);
      expect(c.payments?.periods.map((p) => p.status)).toEqual(['upcoming', 'upcoming']);
      expect(c.payments?.nextDueOn).toBe('2045-03-15');
      const res = await patch(c.id, {
        schedule: {
          frequency: 'everyMonths',
          everyMonths: 5,
          amountMinor: 100,
          startsOn: '2045-01-01',
        },
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json<FinanceItemDetail>().payments?.periods.map((p) => p.dueOn)).toEqual([
        '2045-01-01',
        '2045-06-01',
        '2045-11-01',
      ]);
      const none = await patch(c.id, { schedule: null });
      expect(none.json<FinanceItemDetail>().schedule).toBeNull();
    });

    it('refuses a schedule with no payment, and an end that would leave it none', async () => {
      const g = await newGroup();
      const empty = await call(
        'POST',
        `/api/groups/${g.id}/finance/items`,
        contractBody({
          schedule: { frequency: 'monthly', amountMinor: 1, startsOn: '2013-01-01' },
        }),
      );
      expect(empty.json()).toEqual({ error: 'invalid_schedule' });
      const c = await clientItem(
        g.id,
        contractBody({
          schedule: { frequency: 'monthly', amountMinor: 1, startsOn: '2012-06-01' },
        }),
      );
      expect((await patch(c.id, { endsOn: '2012-05-31', startsOn: '2012-01-01' })).json()).toEqual({
        error: 'invalid_schedule',
      });
      expect((await patch(c.id, { endsOn: '2012-06-30' })).statusCode).toBe(200);
    });

    it('a schedule on anything but a contract is refused', async () => {
      const g = await newGroup();
      const doc = await clientItem(g.id, { type: 'document', title: 'X' });
      const res = await patch(doc.id, {
        schedule: { frequency: 'monthly', amountMinor: 1, startsOn: '2012-01-01' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('documents linked to a contract', () => {
    it('shows the contract on the document and the document on the contract; unlinks', async () => {
      const g = await newGroup();
      const c = await clientItem(g.id, contractBody({ title: 'Zmluva o poradenstve' }));
      const doc = await clientItem(g.id, {
        type: 'document',
        title: 'Faktúra 7/2012',
        contractLink: { contractId: c.id, payment: { amount: eur(12_000), paidOn: '2012-07-10' } },
      });
      expect(doc.contractLink).toEqual({
        contract: expect.objectContaining({ id: c.id, title: 'Zmluva o poradenstve' }),
        payment: { amount: eur(12_000), paidOn: '2012-07-10' },
      });
      expect((await detail(c.id)).documents).toEqual([
        {
          id: doc.id,
          groupId: g.id,
          title: 'Faktúra 7/2012',
          payment: { amount: eur(12_000), paidOn: '2012-07-10' },
        },
      ]);
      const unlinked = await patch(doc.id, { contractLink: null });
      expect(unlinked.json<FinanceItemDetail>().contractLink).toBeNull();
      expect((await detail(c.id)).documents).toEqual([]);
    });

    it("refuses another client's contract, a note, and a contract on a contract", async () => {
      const [a, b] = await Promise.all([newGroup(), newGroup()]);
      const ofA = await clientItem(a.id, contractBody());
      const res = await call('POST', `/api/groups/${b.id}/finance/items`, {
        type: 'document',
        title: 'Cudzí',
        contractLink: { contractId: ofA.id },
      });
      expect(res.json()).toEqual({ error: 'invalid_contract' });
      const note = await clientItem(a.id, { type: 'note', title: 'Pozn.' });
      expect((await patch(note.id, { contractLink: { contractId: ofA.id } })).statusCode).toBe(400);
      expect((await patch(ofA.id, { contractLink: { contractId: ofA.id } })).statusCode).toBe(400);
      const unknown = await call('POST', `/api/groups/${a.id}/finance/items`, {
        type: 'document',
        title: 'Nič',
        contractLink: { contractId: randomUUID() },
      });
      expect(unknown.json()).toEqual({ error: 'invalid_contract' });
    });

    it("links to a contract of several clients: the organisation's document or a client's", async () => {
      const [a, b, c] = await Promise.all([newGroup(), newGroup(), newGroup()]);
      const shared = await sharedContract([
        { groupId: a.id, amountMinor: 300 },
        { groupId: b.id, amountMinor: 100 },
      ]);
      const org = await call('POST', '/api/finance/org/items', {
        type: 'document',
        title: 'Faktúra mikroregiónu',
        contractLink: { contractId: shared.id },
      });
      expect(org.statusCode, org.body).toBe(201);
      await clientItem(a.id, {
        type: 'document',
        title: 'Kópia A',
        contractLink: { contractId: shared.id },
      });
      const ofC = await call('POST', `/api/groups/${c.id}/finance/items`, {
        type: 'document',
        title: 'C',
        contractLink: { contractId: shared.id },
      });
      expect(ofC.statusCode).toBe(400);
      // The whole contract lists both; client A's tab only its own document.
      expect((await detail(shared.id)).documents).toHaveLength(2);
      expect((await detail(shared.id, a.id)).documents?.map((d) => d.title)).toEqual(['Kópia A']);
    });

    it('deleting a linked document records the change on the contract', async () => {
      const g = await newGroup();
      const c = await clientItem(g.id, contractBody());
      const doc = await clientItem(g.id, {
        type: 'document',
        title: 'Faktúra',
        contractLink: { contractId: c.id },
      });
      expect((await call('DELETE', `/api/finance/items/${doc.id}`)).statusCode).toBe(204);
      const rows = await auditRowsOf(test.deps.db, c.id);
      expect(rows.map((r) => r.action)).toEqual(['created', 'updated', 'updated']);
      expect(rows[1]!.changes).toMatchObject({ documents: { added: [{ id: doc.id }] } });
      expect(rows[2]!.changes).toMatchObject({ documents: { removed: [{ id: doc.id }] } });
    });
  });

  describe('the overview counts the expected payments ("očakávané")', () => {
    it("a client's tab: expected by month, received, and the schedule's summary", async () => {
      const g = await newGroup();
      const c = await clientItem(
        g.id,
        contractBody({
          title: 'Mesačný paušál',
          schedule: { frequency: 'quarterly', amountMinor: 30_000, startsOn: '2012-01-01' },
        }),
      );
      await clientItem(g.id, {
        type: 'document',
        title: 'Platba Q1',
        contractLink: { contractId: c.id, payment: { amount: eur(30_000), paidOn: '2012-02-10' } },
      });
      const res = await call('GET', `/api/groups/${g.id}/finance/overview?from=2012-01&to=2012-12`);
      expect(res.statusCode, res.body).toBe(200);
      const o = res.json<FinanceOverviewDto>();
      expect(o.expected).toEqual([
        {
          currency: 'EUR',
          expected: 120_000,
          received: 30_000,
          byMonth: [
            { month: '2012-01', expected: 30_000, received: 0 },
            { month: '2012-02', expected: 0, received: 30_000 },
            { month: '2012-04', expected: 30_000, received: 0 },
            { month: '2012-07', expected: 30_000, received: 0 },
            { month: '2012-10', expected: 30_000, received: 0 },
          ],
        },
      ]);
      expect(o.schedules).toEqual([
        expect.objectContaining({
          contractId: c.id,
          title: 'Mesačný paušál',
          frequency: 'quarterly',
          everyMonths: 3,
          amount: eur(30_000),
          upcoming: [],
          unpaidCount: 3,
          partialCount: 0,
        }),
      ]);
      expect(o.schedules?.[0]?.recent.map((p) => p.status)).toEqual([
        'paid',
        'unpaid',
        'unpaid',
        'unpaid',
      ]);
      // The contract's own money is unchanged by its schedule.
      expect(o.money[0]?.paid).toBe(720_000);
    });

    it("a contract of several clients counts each client's part of its schedule", async () => {
      const [a, b] = await Promise.all([newGroup(), newGroup()]);
      await sharedContract(
        [
          { groupId: a.id, amountMinor: 300 },
          { groupId: b.id, amountMinor: 100 },
        ],
        { schedule: { frequency: 'yearly', amountMinor: 1_000, startsOn: '2012-03-01' } },
      );
      const tab = async (groupId: string) =>
        (
          await call('GET', `/api/groups/${groupId}/finance/overview?from=2012-01&to=2012-12`)
        ).json<FinanceOverviewDto>();
      expect((await tab(a.id)).expected?.[0]?.expected).toBe(750);
      expect((await tab(b.id)).expected?.[0]?.expected).toBe(250);
      const both = await call(
        'GET',
        `/api/finance/overview?from=2012-01&to=2012-12&clients=${a.id},${b.id}`,
      );
      expect(both.statusCode, both.body).toBe(200);
      expect(both.json<FinanceOverviewDto>().expected?.[0]?.expected).toBe(1_000);
    });
  });

  describe('contract choices', () => {
    it("a client's own contracts and those it has a share of; the organisation's shared ones", async () => {
      const [a, b] = await Promise.all([newGroup(), newGroup()]);
      const own = await clientItem(a.id, contractBody());
      const child = await clientItem(a.id, contractBody({ parentId: own.id }));
      const shared = await sharedContract([
        { groupId: a.id, amountMinor: 1 },
        { groupId: b.id, amountMinor: 1 },
      ]);
      await clientItem(b.id, contractBody());
      const res = await call('GET', `/api/finance/contract-choices?group=${a.id}`);
      expect(res.statusCode).toBe(200);
      const choices = res.json<ContractChoice[]>();
      expect(choices.map((c) => c.id).sort()).toEqual([own.id, child.id, shared.id].sort());
      expect(choices.find((c) => c.id === own.id)).toMatchObject({ hasChildren: true });
      expect(choices.find((c) => c.id === child.id)).toMatchObject({ parentId: own.id });
      const org = (await call('GET', '/api/finance/contract-choices')).json<ContractChoice[]>();
      expect(org.map((c) => c.id)).toContain(shared.id);
      expect(org.map((c) => c.id)).not.toContain(own.id);
    });
  });

  describe('the finance right', () => {
    it('without it every contract route answers 403, for an admin and a client alike', async () => {
      const g = await newGroup();
      const client = await clientIn(g.id);
      const c = await clientItem(
        g.id,
        contractBody({
          schedule: { frequency: 'monthly', amountMinor: 1, startsOn: '2012-01-01' },
        }),
      );
      for (const cookie of [plain.cookie, client.cookie]) {
        for (const [method, url] of [
          ['GET', `/api/finance/items/${c.id}`],
          ['GET', `/api/finance/contract-choices?group=${g.id}`],
          ['GET', `/api/groups/${g.id}/finance/overview?from=2012-01&to=2012-12`],
        ] as const) {
          expect((await call(method, url, undefined, cookie)).statusCode).toBe(403);
        }
        const res = await call(
          'PATCH',
          `/api/finance/items/${c.id}`,
          { schedule: null, updatedAt: c.updatedAt },
          cookie,
        );
        expect(res.statusCode).toBe(403);
      }
      expect((await detail(c.id)).schedule).not.toBeNull();
    });
  });

  describe('the audit log', () => {
    it("records a contract's master, schedule and a document's contract and payment", async () => {
      const g = await newGroup();
      const master = await clientItem(g.id, contractBody({ title: 'Rámcová' }));
      const c = await clientItem(
        g.id,
        contractBody({
          parentId: master.id,
          schedule: { frequency: 'monthly', amountMinor: 60_000, startsOn: '2012-01-01' },
        }),
      );
      const created = (await auditRowsOf(test.deps.db, c.id))[0]!;
      expect(created.category).toBe('finance');
      expect(created.changes).toMatchObject({
        parent: { to: { id: master.id, label: 'Rámcová' } },
        schedule: { to: 'monthly · 600.00 EUR · 2012-01-01–' },
      });
      expect((await auditRowsOf(test.deps.db, master.id)).map((r) => r.changes)).toEqual([
        expect.anything(),
        expect.objectContaining({
          children: expect.objectContaining({ added: [expect.objectContaining({ id: c.id })] }),
        }),
      ]);
      await patch(c.id, {
        schedule: { frequency: 'yearly', amountMinor: 1, startsOn: '2012-01-01' },
      });
      const updated = (await auditRowsOf(test.deps.db, c.id)).at(-1)!;
      expect(updated.changes).toMatchObject({
        schedule: {
          from: 'monthly · 600.00 EUR · 2012-01-01–',
          to: 'yearly · 0.01 EUR · 2012-01-01–',
        },
      });
      const doc = await clientItem(g.id, { type: 'document', title: 'Faktúra' });
      await patch(doc.id, {
        contractLink: { contractId: c.id, payment: { amount: eur(500), paidOn: '2012-02-01' } },
      });
      const linked = (await auditRowsOf(test.deps.db, doc.id)).at(-1)!;
      expect(linked.changes).toMatchObject({
        contract: { to: { id: c.id } },
        payment: { to: { minor: 500, currency: 'EUR' } },
        paidOn: { to: '2012-02-01' },
      });
    });
  });

  describe('files on a contract', () => {
    it('a contract keeps finance-only files like any finance item', async () => {
      const g = await newGroup();
      const upload = await test.app.inject({
        method: 'POST',
        url: `/api/groups/${g.id}/finance/files`,
        headers: {
          cookie: fin.cookie,
          'content-type': 'application/pdf',
          'x-file-name': encodeURIComponent('zmluva.pdf'),
        },
        payload: Buffer.from('%PDF-1.4 zmluva'),
      });
      expect(upload.statusCode, upload.body).toBe(201);
      const file = upload.json<FileInfo>();
      const c = await clientItem(g.id, contractBody({ fileIds: [file.id] }));
      expect(c.files.map((f) => f.id)).toEqual([file.id]);
      expect((await call('GET', `/api/files/${file.id}`, undefined, plain.cookie)).statusCode).toBe(
        404,
      );
    });
  });
});
