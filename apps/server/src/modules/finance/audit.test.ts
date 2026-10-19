import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuditPageSchema,
  type BoardDto,
  type FinanceFolder,
  type FinanceItemDetail,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { auditRowsOf } from '../audit/test-helpers.js';
import { addManager } from '../groups/managers.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
type Session = { id: string; cookie: string };
const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
const eur = (amountMinor: number) => ({ amountMinor, currency: 'EUR' });

describe('finance: audit rows (every one a finance row)', () => {
  let test: TestApp;
  let fin: Session;
  let plain: Session;
  const admins: string[] = [];

  async function adminSession(finance: boolean, name: string): Promise<Session> {
    const email = newEmail();
    const admin = await addAdmin(test.deps.db, { email, name });
    admins.push(admin.id);
    if (finance) await setFinanceAccess(test.deps.db, admin.id, admin.id);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  beforeAll(async () => {
    test = await buildTestApp();
    fin = await adminSession(true, 'Finančníčka');
    plain = await adminSession(false, 'Bez práva');
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const newGroup = (name = 'Mesto Senica') => createGroup(db(), { name, egrantUrl: newUrl() });

  it('item create, update (amount from and to) and delete; the note only as changed', async () => {
    const g = await newGroup();
    const res = await call('POST', `/api/groups/${g.id}/finance/items`, fin.cookie, {
      type: 'contract',
      title: 'Zmluva o dielo',
      contractNumber: 'Z-1',
      amount: eur(100_000),
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      body: 'Tajná poznámka k zmluve 1x',
    });
    expect(res.statusCode, res.body).toBe(201);
    const item = res.json<FinanceItemDetail>();
    const patched = await call('PATCH', `/api/finance/items/${item.id}`, fin.cookie, {
      amount: eur(150_000),
      updatedAt: item.updatedAt,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    expect((await call('DELETE', `/api/finance/items/${item.id}`, fin.cookie)).statusCode).toBe(
      204,
    );
    const rows = await auditRowsOf(db(), item.id);
    expect(rows.map((r) => [r.action, r.category, r.groupId])).toEqual([
      ['created', 'finance', g.id],
      ['updated', 'finance', g.id],
      ['deleted', 'finance', g.id],
    ]);
    expect(rows[0]!.changes).toMatchObject({
      title: { to: 'Zmluva o dielo' },
      amount: { to: { minor: 100_000, currency: 'EUR' } },
      note: { changed: true },
    });
    expect(rows[1]!.changes).toEqual({
      amount: {
        from: { minor: 100_000, currency: 'EUR' },
        to: { minor: 150_000, currency: 'EUR' },
      },
    });
    expect(JSON.stringify(rows)).not.toContain('Tajná poznámka');
  });

  it('a shared contract has no group and its clients as shares', async () => {
    const [g1, g2] = await Promise.all([newGroup('Obec A'), newGroup('Obec B')]);
    const res = await call('POST', '/api/finance/org/items', fin.cookie, {
      type: 'contract',
      title: 'Spoločný grant',
      amount: eur(300),
      startsOn: '2026-02-01',
      endsOn: '2026-12-31',
      payerName: 'Mikroregión',
      shares: [
        { groupId: g1.id, amountMinor: 100 },
        { groupId: g2.id, amountMinor: 200 },
      ],
    });
    expect(res.statusCode, res.body).toBe(201);
    const [row] = await auditRowsOf(db(), res.json<FinanceItemDetail>().id);
    expect(row).toMatchObject({ groupId: null, category: 'finance' });
    const shares = (row!.changes.shares as { added: { id: string; label: string }[] }).added;
    expect(shares.map((s) => s.label).sort()).toEqual(['Obec A', 'Obec B']);
  });

  it('folder create, rename, delete', async () => {
    const g = await newGroup();
    const res = await call('POST', `/api/groups/${g.id}/finance/folders`, fin.cookie, {
      name: 'Zmluvy',
    });
    expect(res.statusCode, res.body).toBe(201);
    const folder = res.json<FinanceFolder>();
    await call('PATCH', `/api/finance/folders/${folder.id}`, fin.cookie, { name: 'Zmluvy 2026' });
    await call('DELETE', `/api/finance/folders/${folder.id}`, fin.cookie);
    const rows = await auditRowsOf(db(), folder.id);
    expect(rows.map((r) => [r.entityType, r.action, r.category])).toEqual([
      ['finance_folder', 'created', 'finance'],
      ['finance_folder', 'updated', 'finance'],
      ['finance_folder', 'deleted', 'finance'],
    ]);
  });

  it('a manual entry create, update and delete; minutes as minutes', async () => {
    const g = await newGroup();
    const res = await call('POST', `/api/groups/${g.id}/finance/time-entries`, fin.cookie, {
      userId: fin.id,
      workedOn: '2026-10-01',
      minutes: 90,
      note: '',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = res.json<{ id: string }>();
    await call('PATCH', `/api/finance/time-entries/${id}`, fin.cookie, { minutes: 120 });
    await call('DELETE', `/api/finance/time-entries/${id}`, fin.cookie);
    const rows = await auditRowsOf(db(), id);
    expect(rows.map((r) => [r.action, r.category])).toEqual([
      ['created', 'finance'],
      ['updated', 'finance'],
      ['deleted', 'finance'],
    ]);
    expect(rows[1]!.changes).toEqual({ minutes: { from: 90, to: 120 } });
  });

  it("PUT /tasks/:id/time/me records time_entry created, then updated, by the admin; the task's rows carry no time", async () => {
    const g = await newGroup();
    await addManager(db(), g.id, fin.id);
    const created = await call('POST', `/api/groups/${g.id}/tasks`, fin.cookie, {
      title: 'Rozpočet',
      description: '',
      assigneeIds: [fin.id],
      dueDate: null,
      urgent: false,
      fileIds: [],
      link: null,
    });
    expect(created.statusCode, created.body).toBe(201);
    const taskId = created.json<{ id: string }>().id;
    expect(
      (await call('PUT', `/api/tasks/${taskId}/time/me`, fin.cookie, { minutes: 30 })).statusCode,
    ).toBe(200);
    expect(
      (await call('PUT', `/api/tasks/${taskId}/time/me`, fin.cookie, { minutes: 45 })).statusCode,
    ).toBe(200);
    const board = (await call('GET', `/api/groups/${g.id}/board`, fin.cookie)).json<BoardDto>();
    const done = board.buckets.find((b) => b.kind === 'done')!;
    await call('POST', `/api/tasks/${taskId}/move`, fin.cookie, {
      bucketId: done.id,
      afterTaskId: null,
    });
    const page = AuditPageSchema.parse(
      (await call('GET', `/api/audit?group=${g.id}&entityType=time_entry`, fin.cookie)).json(),
    );
    expect(page.items.map((i) => i.action).reverse()).toEqual(['created', 'updated']);
    expect(page.items[0]!.changes).toEqual({ minutes: { from: 30, to: 45 } });
    const taskRows = await auditRowsOf(db(), taskId);
    for (const row of taskRows) {
      expect(row.category).toBe('general');
      for (const kind of Object.keys(row.changes))
        expect(['minutes', 'amount']).not.toContain(kind);
    }
    // A non-finance admin's page of the group shows the task, never the time.
    const general = AuditPageSchema.parse(
      (await call('GET', `/api/audit?group=${g.id}`, plain.cookie)).json(),
    );
    expect(general.items.length).toBeGreaterThan(0);
    expect(general.items.every((i) => i.entityType === 'task')).toBe(true);
  });

  it('rate add and delete', async () => {
    const res = await call('POST', '/api/finance/rates', fin.cookie, {
      userId: plain.id,
      rateMinor: 2500,
      effectiveFrom: '2026-01-01',
    });
    expect(res.statusCode, res.body).toBe(201);
    const { id } = res.json<{ id: string }>();
    expect((await call('DELETE', `/api/finance/rates/${id}`, fin.cookie)).statusCode).toBe(204);
    const rows = await auditRowsOf(db(), id);
    expect(rows.map((r) => [r.action, r.category, r.entityLabel])).toEqual([
      ['created', 'finance', 'Bez práva'],
      ['deleted', 'finance', 'Bez práva'],
    ]);
    expect(rows[0]!.changes).toMatchObject({
      amount: { to: { minor: 2500, currency: 'EUR' } },
      validFrom: { to: '2026-01-01' },
    });
  });

  it("a non-finance admin's GET /api/audit never shows finance rows", async () => {
    const page = AuditPageSchema.parse(
      (await call('GET', `/api/audit?actor=user:${fin.id}&limit=100`, plain.cookie)).json(),
    );
    const finance = ['finance_item', 'finance_folder', 'time_entry', 'rate', 'finance_access'];
    expect(page.items.some((i) => finance.includes(i.entityType))).toBe(false);
  });
});
