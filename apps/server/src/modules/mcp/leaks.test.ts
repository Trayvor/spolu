import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileInfo, SessionUser } from '@spolu/shared';
import { auditRowsOf } from '../audit/test-helpers.js';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpRequest, mcpToken } from '../../../test/mcp.js';
import { insertTask } from '../../../test/tasks.js';
import { INTERNAL_CALL_HEADER, runAsUser } from '../auth/internal-calls.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup, setGroupDeactivated } from '../groups/service.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setFinanceAccess,
} from '../users/service.js';
import { ALLOWED_ROUTES, isAllowedRoute, isAllowedRoutePattern } from './allowlist.js';
import { createApiCaller, RouteNotAllowedError } from './call.js';
import { ALL_TOOLS } from './tools/index.js';

/**
 * The finance rule of MCP (owner decision 2026-10-18, spec §2 #5–6): every finance entity, read
 * and write, for finance holders only; a non-finance admin, a client and a žiadateľ never get
 * finance data; a client's finance answers hold no other client's data. Plus the allowlist and
 * the internal-call header.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** Keys that carry money or time; none may appear in an answer to someone without the right. */
const FINANCE_KEYS =
  /"(amount|amountMinor|currency|rateMinor|rate|rates|cost|costMinor|minutes|askTime|timeRequests|timeRequestCount|coveredByTasks|paid|toBePaid|balance)"\s*:/;

/** A path of finance or time data: every allowlist entry matching it must be marked `finance`. */
const FINANCE_PATH = /\/finance(\/|$)|\/time(\/|$)/;

const userOf = (role: SessionUser['role'], finance: boolean): SessionUser => ({
  id: 'x',
  email: 'x@example.com',
  name: 'X',
  role,
  finance,
});

describe('MCP allowlist', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });

  it('every entry is a registered route', () => {
    for (const route of ALLOWED_ROUTES) {
      expect({
        route,
        exists: test.app.hasRoute({ method: route.method, url: route.path }),
      }).toEqual({ route, exists: true });
    }
  });

  it('every finance and time route is marked finance', () => {
    for (const route of ALLOWED_ROUTES) {
      if (FINANCE_PATH.test(route.path))
        expect({ route, finance: route.finance }).toEqual({ route, finance: true });
    }
  });

  it('holds no token, auth, grant, upload or delete route', () => {
    for (const route of ALLOWED_ROUTES) {
      expect(route.path).not.toMatch(/\/me\/mcp|\/auth|finance-access|\/files$/);
      if (route.method === 'DELETE') {
        // Unassigning a riešiteľ is the only DELETE: it removes no entity.
        expect(route.path).toBe('/api/tickets/:id/assignees/:userId');
      }
    }
  });

  it.each([
    ['GET', '/api/finance/overview'],
    ['GET', '/api/groups/g1/finance/work-log'],
    ['POST', '/api/finance/rates'],
    ['GET', '/api/tasks/t1/time'],
    ['PUT', '/api/tickets/t1/time/me'],
  ])('a finance route %s %s is refused to everyone without the right', async (method, path) => {
    expect(isAllowedRoute(method, path, userOf('superadmin', true))).toBe(true);
    expect(isAllowedRoute(method, path, userOf('admin', true))).toBe(true);
    for (const user of [userOf('admin', false), userOf('client', false), userOf('client', true)]) {
      expect(isAllowedRoute(method, path, user)).toBe(false);
      const api = createApiCaller(test.app, user, '127.0.0.1', 'write');
      await expect(api(method as 'GET', path)).rejects.toBeInstanceOf(RouteNotAllowedError);
    }
  });

  it.each([
    ['DELETE', '/api/finance/items/i1'],
    ['DELETE', '/api/finance/rates/r1'],
    ['DELETE', '/api/finance/time-entries/e1'],
    ['PUT', '/api/admins/a1/finance-access'],
    ['POST', '/api/groups/g1/finance/files'],
    ['GET', '/api/me/mcp/tokens'],
    ['POST', '/api/me/mcp/tokens'],
    ['DELETE', '/api/tasks/t1'],
    ['GET', '/api/tasks/../finance/overview'],
    ['GET', '/api/tasks/t1%2F..%2Ffinance'],
  ])('refuses %s %s to anyone', async (method, path) => {
    const superadmin = userOf('superadmin', true);
    expect(isAllowedRoute(method, path, superadmin)).toBe(false);
    const api = createApiCaller(test.app, superadmin, '127.0.0.1', 'write');
    await expect(api(method as 'GET', path)).rejects.toBeInstanceOf(RouteNotAllowedError);
  });

  it('matches the route pattern exactly: a static sibling of an entry is refused', async () => {
    const admin = userOf('admin', false);
    // `/api/tasks/:id` is listed; the static `/api/tasks/search` matches its regex but is not.
    expect(isAllowedRoutePattern('GET', '/api/tasks/:id', admin)).toBe(true);
    expect(isAllowedRoutePattern('GET', '/api/tasks/search', admin)).toBe(false);
    expect(isAllowedRoutePattern('POST', '/api/tasks/:id', admin)).toBe(false);
    expect(isAllowedRoutePattern('GET', '/api/finance/overview', admin)).toBe(false);
    expect(isAllowedRoutePattern('GET', '/api/finance/overview', userOf('admin', true))).toBe(true);

    const api = createApiCaller(test.app, admin, '127.0.0.1', 'write');
    const sibling = await api('GET', '/api/tasks/search', { query: { q: 'x' } });
    expect(sibling.status).toBe(403);
    expect(sibling.body).toMatchObject({ error: 'forbidden', detail: 'route not allowed for MCP' });
    // A listed static route next to it still answers.
    expect((await api('GET', '/api/tasks/global')).status).not.toBe(403);
  });

  it('an internal call to a route outside the allowlist is refused by the route guard', async () => {
    const res = await runAsUser(userOf('superadmin', true), (headers) =>
      test.app.inject({ method: 'GET', url: '/api/me/mcp/tokens', headers }),
    );
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ detail: 'route not allowed for MCP' });
  });

  it('a read-only caller never sends a non-GET request', async () => {
    const superadmin = userOf('superadmin', true);
    const api = createApiCaller(test.app, superadmin, '127.0.0.1', 'read');
    for (const [method, path] of [
      ['POST', '/api/finance/rates'],
      ['PATCH', '/api/tasks/t1'],
      ['PUT', '/api/tickets/t1/assignees/u1'],
      ['DELETE', '/api/tickets/t1/assignees/u1'],
    ] as const) {
      await expect(api(method, path, { body: {} })).rejects.toBeInstanceOf(RouteNotAllowedError);
    }
    expect((await api('GET', '/api/me/home/counts')).status).toBe(200);
    // A POST marked `read` (it changes nothing) is sent; the route answers.
    const count = await api('POST', '/api/bulk-email/audience/count', { body: {} });
    expect(count.status).not.toBe(403);
  });

  it('marks only POSTs that change nothing as `read`', () => {
    const read = ALLOWED_ROUTES.filter((route) => route.read).map((r) => `${r.method} ${r.path}`);
    expect(read.sort()).toEqual(
      [
        'POST /api/bulk-email/audience/count',
        'POST /api/bulk-email/audience/people',
        'POST /api/messages/:id/task-split',
        'POST /api/messages/:id/translate',
        'POST /api/tickets/:id/ai-draft',
        'POST /api/tickets/:id/task-split',
        'POST /api/tickets/:id/translate',
      ].sort(),
    );
  });

  it('never allows sending or cancelling bulk email, rating a ticket or the calendar feed', () => {
    const paths = ALLOWED_ROUTES.map((r) => r.path);
    for (const path of [
      '/api/bulk-email/campaigns/:id/send',
      '/api/bulk-email/campaigns/:id/cancel',
      '/api/tickets/:id/rating',
      '/api/me/notifications/read',
      '/api/me/notifications/snooze',
    ]) {
      expect(paths).not.toContain(path);
    }
    expect(paths.some((p) => p.includes('calendar-feed'))).toBe(false);
  });

  it('every finance tool is marked finance', () => {
    const names = [
      'finance',
      'work_log',
      'time_entry',
      'rate',
      'contracts',
      'ranking',
      'task_time',
      'ticket_time',
    ];
    for (const tool of ALL_TOOLS.filter((t) => names.some((n) => t.name.includes(n)))) {
      expect({ name: tool.name, finance: tool.finance }).toEqual({
        name: tool.name,
        finance: true,
      });
    }
  });

  it('message search: nothing of a deactivated client through search or search_messages', async () => {
    const db = test.deps.db;
    const email = `${randomUUID()}@example.com`;
    const a = await addAdmin(db, { email, name: 'Ada Admin' });
    const token = await mcpToken(db, a.id);
    const g = await createGroup(db, {
      name: 'Zavretá firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const w = `zq${randomUUID().replaceAll('-', '').replace(/[0-9]/g, 'y').slice(0, 10)}`;
    const channel = (await callTool(test.app, token, 'get_chat_channel', { groupId: g.id }))
      .json as { id: string };
    await callTool(test.app, token, 'send_message', { channelId: channel.id, body: `Tajné ${w}` });
    const found = await callTool(test.app, token, 'search_messages', { q: w });
    expect((found.json as { hits: unknown[] }).hits).toHaveLength(1);
    await setGroupDeactivated(db, g.id, true);
    try {
      for (const args of [{ q: w }, { q: w, groupId: g.id }]) {
        const page = await callTool(test.app, token, 'search_messages', args);
        expect(page.json).toEqual({ hits: [], nextCursor: null, tooBroad: false });
      }
      const all = await callTool(test.app, token, 'search', { q: w, types: 'messages' });
      expect(all.json).toEqual({ messages: [] });
      expect(all.raw).not.toContain('Tajné');
    } finally {
      await deactivateUser(db, a.id);
    }
  });

  it('the internal-call header from outside is no session', async () => {
    const res = await test.app.inject({
      method: 'GET',
      url: '/api/me/home/counts',
      headers: { [INTERNAL_CALL_HEADER]: randomUUID() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('MCP finance access and leaks', () => {
  let test: TestApp;
  let groupId: string;
  let otherGroupId: string;
  let contractId: string;
  let financeFileId: string;
  let taskId: string;
  let fin: { id: string; token: string; readToken: string };
  let plain: { id: string; token: string };
  const admins: string[] = [];
  const word = `Zmluva${randomUUID().slice(0, 8)}`;
  const otherWord = `Iny${randomUUID().slice(0, 8)}`;

  const financeCalls = (): Array<[string, Record<string, unknown>]> => [
    ['list_finance_documents', { groupId }],
    ['list_finance_document_folders', { groupId }],
    ['get_finance_document', { itemId: contractId }],
    ['get_finance_overview', { groupId }],
    ['get_finance_overview', {}],
    ['get_work_log', { groupId }],
    ['get_work_log', {}],
    ['list_rates', {}],
    ['list_contracts', {}],
    ['get_paid_ranking', {}],
    ['get_hours_ranking', {}],
    ['get_task_time', { taskId }],
    ['list_salaries', {}],
    // Contracts v2 (ADR 0066).
    ['get_contract', { contractId }],
    ['get_contract_payments', { contractId }],
    ['list_contract_attachments', { contractId }],
    ['list_contract_choices', { groupId }],
  ];

  beforeAll(async () => {
    test = await buildTestApp();
    const db = test.deps.db;
    const finEmail = `${randomUUID()}@example.com`;
    const finRow = await addAdmin(db, { email: finEmail, name: 'Fina' });
    const plainRow = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Pavol' });
    admins.push(finRow.id, plainRow.id);
    await setFinanceAccess(db, finRow.id, finRow.id);
    fin = {
      id: finRow.id,
      token: await mcpToken(db, finRow.id, 'write'),
      readToken: await mcpToken(db, finRow.id, 'read'),
    };
    plain = { id: plainRow.id, token: await mcpToken(db, plainRow.id, 'write') };
    const cookie = await loginAs(test.app, finEmail);
    const egrant = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;
    groupId = (await createGroup(db, { name: 'Firma', egrantUrl: egrant() })).id;
    otherGroupId = (await createGroup(db, { name: 'Iná firma', egrantUrl: egrant() })).id;
    const inject = (method: 'POST' | 'PUT', url: string, payload: object) =>
      test.app.inject({ method, url, headers: { cookie }, payload });

    const upload = await test.app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/finance/files`,
      headers: { cookie, 'content-type': 'text/plain', 'x-file-name': `${word}.txt` },
      payload: Buffer.from(`${word} scan`),
    });
    expect(upload.statusCode, upload.body).toBe(201);
    financeFileId = upload.json<FileInfo>().id;
    const contract = await inject('POST', `/api/groups/${groupId}/finance/items`, {
      type: 'contract',
      title: `${word} grant`,
      contractNumber: `${word}-1`,
      body: 'Signed copy attached.',
      amount: { amountMinor: 1_234_567, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      fileIds: [financeFileId],
    });
    expect(contract.statusCode, contract.body).toBe(201);
    contractId = contract.json<{ id: string }>().id;
    // Another client's contract and time: never in the first client's answers.
    expect(
      (
        await inject('POST', `/api/groups/${otherGroupId}/finance/items`, {
          type: 'contract',
          title: `${otherWord} grant`,
          amount: { amountMinor: 7_654_321, currency: 'EUR' },
          startsOn: '2026-01-01',
          endsOn: '2026-12-31',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await inject('POST', `/api/groups/${otherGroupId}/finance/time-entries`, {
          userId: finRow.id,
          workedOn: '2026-01-06',
          minutes: 45,
          note: `${otherWord} manual`,
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await inject('POST', '/api/finance/rates', {
          userId: fin.id,
          rateMinor: 4_200,
          effectiveFrom: null,
        })
      ).statusCode,
    ).toBe(201);
    const manual = await inject('POST', `/api/groups/${groupId}/finance/time-entries`, {
      userId: fin.id,
      workedOn: '2026-01-05',
      minutes: 95,
      note: `${word} manual`,
    });
    expect(manual.statusCode, manual.body).toBe(201);
    taskId = await insertTask(db, { groupId, createdBy: fin.id, assignees: [fin.id], done: true });
    const time = await inject('PUT', `/api/tasks/${taskId}/time/me`, { minutes: 75 });
    expect(time.statusCode, time.body).toBe(200);
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  it('a finance admin reads every finance entity, as over HTTP', async () => {
    for (const [name, args] of financeCalls()) {
      const res = await callTool(test.app, fin.token, name, args);
      expect({ name, isError: res.isError, json: res.isError ? res.json : null }).toEqual({
        name,
        isError: false,
        json: null,
      });
    }
    const one = await callTool(test.app, fin.token, 'get_finance_document', { itemId: contractId });
    expect(one.json).toMatchObject({
      title: `${word} grant`,
      contract: { amount: { amountMinor: 1_234_567, currency: 'EUR' } },
    });
    const log = await callTool(test.app, fin.token, 'get_work_log', { groupId });
    expect(log.raw).toContain(`${word} manual`);
    const file = await callTool(test.app, fin.token, 'read_file', { fileId: financeFileId });
    expect(file.content.map((c) => c.text).join('\n')).toContain(`${word} scan`);
  });

  it('organisation items: a shared contract’s client view holds only that client’s share', async () => {
    const shared = await callTool(test.app, fin.token, 'create_organisation_finance_item', {
      item: {
        type: 'contract',
        title: `${word} spoločná`,
        payerName: 'Mikroregión',
        amount: { amountMinor: 300_000, currency: 'EUR' },
        startsOn: '2026-01-01',
        endsOn: '2026-12-31',
        shares: [
          { groupId, amountMinor: 100_000 },
          { groupId: otherGroupId, amountMinor: 200_000 },
        ],
      },
    });
    expect(shared.isError, shared.raw).toBe(false);
    const sharedId = (shared.json as { id: string }).id;
    const expense = await callTool(test.app, fin.token, 'create_organisation_finance_item', {
      item: {
        type: 'expense',
        title: 'Server',
        amount: { amountMinor: 250_000, currency: 'EUR' },
        spentOn: '2026-01-31',
      },
    });
    expect(expense.isError, expense.raw).toBe(false);
    const org = await callTool(test.app, fin.token, 'list_finance_documents', {});
    expect(org.raw).toContain(sharedId);
    expect(org.raw).toContain((expense.json as { id: string }).id);
    expect((await callTool(test.app, fin.token, 'list_finance_payees', {})).raw).toContain(fin.id);
    // The whole contract on /finance: every share.
    const whole = await callTool(test.app, fin.token, 'get_finance_document', { itemId: sharedId });
    expect(whole.raw).toContain(otherGroupId);
    // The first client's view: its own share, never the other client or its share.
    for (const res of [
      await callTool(test.app, fin.token, 'get_finance_document', { itemId: sharedId, groupId }),
      await callTool(test.app, fin.token, 'list_finance_documents', { groupId, type: 'contract' }),
    ]) {
      expect(res.isError, res.raw).toBe(false);
      expect(res.raw).toContain(sharedId);
      expect(res.raw).not.toContain(otherGroupId);
      expect(res.raw).not.toContain('Iná firma');
      expect(res.raw).not.toContain('200000');
    }
    // A plain admin reaches none of it.
    for (const [name, args] of [
      ['list_finance_documents', {}],
      ['get_finance_document', { itemId: sharedId }],
      ['list_finance_payees', {}],
    ] as const) {
      const res = await callTool(test.app, plain.token, name, args);
      expect(res.json).toMatchObject({ status: 403 });
    }
  });

  it('a client’s finance answers hold no other client’s data', async () => {
    for (const [name, args] of [
      ['list_finance_documents', { groupId }],
      ['list_finance_documents', { groupId, type: 'contract' }],
      ['get_finance_overview', { groupId }],
      ['get_work_log', { groupId }],
    ] as const) {
      const res = await callTool(test.app, fin.token, name, args);
      expect({ name, other: res.raw.includes(otherWord) }).toEqual({ name, other: false });
      expect({ name, amount: res.raw.includes('7654321') }).toEqual({ name, amount: false });
    }
  });

  it('a finance admin writes finance entities through the routes, audited', async () => {
    const created = await callTool(test.app, fin.token, 'create_finance_document', {
      groupId,
      item: { type: 'note', title: `${word} poznámka`, body: 'Text' },
    });
    expect(created.isError).toBe(false);
    const itemId = (created.json as { id: string }).id;
    const edited = await callTool(test.app, fin.token, 'update_finance_document', {
      itemId,
      changes: { title: `${word} poznámka 2` },
    });
    expect(edited.json).toMatchObject({ title: `${word} poznámka 2` });
    const folder = await callTool(test.app, fin.token, 'create_finance_folder', {
      groupId,
      folder: { name: 'Zmluvy' },
    });
    const folderId = (folder.json as { id: string }).id;
    expect(
      (
        await callTool(test.app, fin.token, 'update_finance_folder', {
          folderId,
          changes: { name: 'Zmluvy 2026' },
        })
      ).json,
    ).toMatchObject({ name: 'Zmluvy 2026' });
    const entry = await callTool(test.app, fin.token, 'add_time_entry', {
      entry: { groupId, userId: fin.id, workedOn: '2026-02-02', minutes: 30, note: 'MCP' },
    });
    expect(entry.isError, entry.raw).toBe(false);
    const entryId = (entry.json as { id: string }).id;
    const patched = await callTool(test.app, fin.token, 'update_time_entry', {
      entryId,
      changes: { minutes: 40 },
    });
    expect(patched.isError, patched.raw).toBe(false);
    const rate = await callTool(test.app, fin.token, 'add_rate', {
      rate: { userId: fin.id, rateMinor: 5_000, effectiveFrom: '2026-02-01' },
    });
    expect(rate.isError, rate.raw).toBe(false);
    const mine = await callTool(test.app, fin.token, 'set_my_task_time', {
      taskId,
      time: { minutes: 80 },
    });
    expect(mine.isError, mine.raw).toBe(false);
    const orgFolder = await callTool(test.app, fin.token, 'create_finance_folder', {
      folder: { name: `${word} org` },
    });
    expect(orgFolder.isError, orgFolder.raw).toBe(false);
    const orgFolders = await callTool(test.app, fin.token, 'list_finance_document_folders', {});
    expect(orgFolders.raw).toContain(`${word} org`);
    const clientFolders = await callTool(test.app, fin.token, 'list_finance_document_folders', {
      groupId,
    });
    expect(clientFolders.raw).not.toContain(`${word} org`);
  });

  it('a finance admin records a salary and links a document through MCP, audited (2026-10-21)', async () => {
    const created = await callTool(test.app, fin.token, 'create_salary', {
      salary: {
        payeeId: fin.id,
        month: '2015-03',
        amount: { amountMinor: 210_000, currency: 'EUR' },
        note: `${word} mzda`,
      },
    });
    expect(created.isError, created.raw).toBe(false);
    const salaryId = (created.json as { id: string }).id;
    const edited = await callTool(test.app, fin.token, 'update_salary', {
      salaryId,
      changes: { amount: { amountMinor: 220_000, currency: 'EUR' } },
    });
    expect(edited.json).toMatchObject({ amount: { amountMinor: 220_000, currency: 'EUR' } });
    const document = await callTool(test.app, fin.token, 'create_organisation_finance_item', {
      item: { type: 'document', title: `${word} páska` },
    });
    const documentId = (document.json as { id: string }).id;
    const expense = await callTool(test.app, fin.token, 'create_organisation_finance_item', {
      item: {
        type: 'expense',
        title: `${word} odvody`,
        amount: { amountMinor: 1, currency: 'EUR' },
        spentOn: '2015-03-31',
      },
    });
    const expenseId = (expense.json as { id: string }).id;
    for (const target of [{ salaryId }, { expenseId }]) {
      const linked = await callTool(test.app, fin.token, 'link_finance_document', {
        documentId,
        ...target,
      });
      expect(linked.isError, linked.raw).toBe(false);
    }
    const both = await callTool(test.app, fin.token, 'link_finance_document', {
      documentId,
      salaryId,
      expenseId,
    });
    expect(both.isError).toBe(true);
    const got = await callTool(test.app, fin.token, 'get_salary', { salaryId });
    expect(got.json).toMatchObject({ documents: [{ id: documentId }], note: `${word} mzda` });
    const listed = await callTool(test.app, fin.token, 'list_salaries', {
      admin: fin.id,
      from: '2015-03',
      to: '2015-03',
    });
    expect(listed.raw).toContain(salaryId);
    expect(listed.raw).toContain('totals');
    const rows = await auditRowsOf(test.deps.db, salaryId);
    expect(rows.map((r) => [r.action, r.actorKind])).toEqual([
      ['created', 'mcp'],
      ['updated', 'mcp'],
      ['updated', 'mcp'],
    ]);
    // Without the right: no salary tool at all.
    for (const [name, args] of [
      ['list_salaries', {}],
      ['get_salary', { salaryId }],
      [
        'create_salary',
        {
          salary: {
            payeeId: plain.id,
            month: '2015-04',
            amount: { amountMinor: 1, currency: 'EUR' },
          },
        },
      ],
      ['update_salary', { salaryId, changes: { note: 'x' } }],
      ['link_finance_document', { documentId, salaryId }],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await callTool(test.app, plain.token, name, args);
      expect({ name, isError: res.isError }).toEqual({ name, isError: true });
      expect(res.raw).not.toContain(word);
      expect(res.raw).not.toContain('220000');
    }
  });

  it('contracts v2: a master, a schedule of 0, a linked payment, the files (ADR 0066)', async () => {
    const master = await callTool(test.app, fin.token, 'create_finance_document', {
      groupId,
      item: {
        type: 'contract',
        title: `${word} rámcová`,
        amount: { amountMinor: 0, currency: 'EUR' },
        startsOn: '2012-01-01',
        endsOn: '2012-12-31',
        schedule: {
          frequency: 'monthly',
          amountMinor: 50_000,
          startsOn: '2012-01-01',
          endsOn: '2012-02-29',
        },
      },
    });
    expect(master.isError, master.raw).toBe(false);
    const masterId = (master.json as { id: string }).id;
    const child = await callTool(test.app, fin.token, 'create_finance_document', {
      groupId,
      item: {
        type: 'contract',
        title: `${word} dodatok`,
        amount: { amountMinor: 100, currency: 'EUR' },
        startsOn: '2012-01-01',
        endsOn: '2012-12-31',
        parentId: masterId,
      },
    });
    expect(child.isError, child.raw).toBe(false);
    const childId = (child.json as { id: string }).id;
    // One level only: a contract under the child is refused.
    const deeper = await callTool(test.app, fin.token, 'update_finance_document', {
      itemId: contractId,
      changes: { parentId: childId },
    });
    expect(deeper.isError).toBe(true);
    expect(deeper.raw).toContain('invalid_parent');
    const doc = await callTool(test.app, fin.token, 'create_finance_document', {
      groupId,
      item: { type: 'document', title: `${word} faktúra` },
    });
    const docId = (doc.json as { id: string }).id;
    const linked = await callTool(test.app, fin.token, 'link_finance_document_to_contract', {
      documentId: docId,
      contractId: masterId,
      payment: { amount: { amountMinor: 50_000, currency: 'EUR' }, paidOn: '2012-01-15' },
    });
    expect(linked.isError, linked.raw).toBe(false);
    expect(linked.json).toMatchObject({ contractLink: { contract: { id: masterId } } });
    const got = await callTool(test.app, fin.token, 'get_contract', { contractId: masterId });
    expect(got.json).toMatchObject({
      contract: { amount: { amountMinor: 0 } },
      children: [{ id: childId }],
      documents: [{ id: docId }],
    });
    const payments = await callTool(test.app, fin.token, 'get_contract_payments', {
      contractId: masterId,
    });
    expect(
      (payments.json as { payments: { periods: { status: string }[] } }).payments.periods.map(
        (p) => p.status,
      ),
    ).toEqual(['paid', 'unpaid']);
    const files = await callTool(test.app, fin.token, 'list_contract_attachments', { contractId });
    expect(files.raw).toContain(financeFileId);
    const choices = await callTool(test.app, fin.token, 'list_contract_choices', { groupId });
    expect(choices.raw).toContain(masterId);
    // A document is no contract for get_contract.
    const notContract = await callTool(test.app, fin.token, 'get_contract', { contractId: docId });
    expect(notContract.isError).toBe(true);
    // Unlinked through the same tool; a plain admin cannot link.
    const unlinked = await callTool(test.app, fin.token, 'link_finance_document_to_contract', {
      documentId: docId,
      contractId: null,
    });
    expect(unlinked.json).toMatchObject({ contractLink: null });
    const refused = await callTool(test.app, plain.token, 'link_finance_document_to_contract', {
      documentId: docId,
      contractId: masterId,
    });
    expect(refused.isError).toBe(true);
    expect(refused.raw).not.toContain(`${word} rámcová`);
  });

  it('a read-only token of a finance admin reads but cannot write finance', async () => {
    const list = await mcpRequest(test.app, fin.readToken, 'tools/list');
    expect(list.body).toContain('list_rates');
    expect(list.body).not.toContain('add_rate');
    const res = await callTool(test.app, fin.readToken, 'add_rate', {
      rate: { userId: fin.id, rateMinor: 1, effectiveFrom: null },
    });
    expect(res.json).toMatchObject({ status: 403, detail: 'read-only token' });
    expect(list.body).toContain('list_finance_payees');
    expect(list.body).not.toContain('create_organisation_finance_item');
    const org = await callTool(test.app, fin.readToken, 'create_organisation_finance_item', {
      item: { type: 'note', title: `${word} read-only` },
    });
    expect(org.json).toMatchObject({ status: 403, detail: 'read-only token' });
    const listed = await callTool(test.app, fin.token, 'list_finance_documents', {
      q: 'read-only',
    });
    expect(listed.raw).not.toContain(`${word} read-only`);
  });

  it('an admin without the right sees no finance tool and gets 403 from each', async () => {
    const list = await mcpRequest(test.app, plain.token, 'tools/list');
    for (const [name] of financeCalls()) expect(list.body).not.toContain(`"${name}"`);
    for (const [name, args] of [
      ...financeCalls(),
      ['create_finance_document', { groupId, item: { type: 'note', title: 'x' } }],
      ['add_rate', { rate: { userId: plain.id, rateMinor: 1, effectiveFrom: null } }],
      ['set_my_task_time', { taskId, time: { minutes: 1 } }],
      ['create_organisation_finance_item', { item: { type: 'note', title: 'x' } }],
      ['create_finance_folder', { folder: { name: 'x' } }],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await callTool(test.app, plain.token, name, args);
      expect({ name, isError: res.isError, json: res.json }).toMatchObject({
        name,
        isError: true,
        json: { status: 403, error: 'forbidden' },
      });
      expect(res.raw).not.toContain(word);
    }
    const file = await callTool(test.app, plain.token, 'read_file', { fileId: financeFileId });
    expect(file.json).toMatchObject({ status: 404 });
    expect(file.raw).not.toContain(word);
  });

  it('no other tool gives money or time to an admin without the right', async () => {
    for (const [name, args] of [
      ['whoami', {}],
      ['get_board', { groupId, done: 50 }],
      ['get_task', { taskId }],
      ['list_all_tasks', { clients: 'all', completed: true }],
      ['list_my_tasks', {}],
      ['list_tickets', { scope: 'all', status: 'all' }],
      ['list_knowledge', { scope: 'all', q: word }],
      ['list_knowledge', { groupId }],
      ['list_upcoming_reminders', {}],
      ['list_projects', { groupId }],
    ] as Array<[string, Record<string, unknown>]>) {
      const res = await callTool(test.app, plain.token, name, args);
      expect({ name, error: res.isError, json: res.isError ? res.json : null }).toEqual({
        name,
        error: false,
        json: null,
      });
      expect({ name, leak: FINANCE_KEYS.exec(res.raw)?.[0] ?? null }).toEqual({ name, leak: null });
      expect({ name, word: res.raw.includes(word) }).toEqual({ name, word: false });
    }
  });

  it('the check would see money: the finance admin’s own answer has it', async () => {
    const res = await callTool(test.app, fin.token, 'get_finance_document', { itemId: contractId });
    expect(res.raw).toMatch(FINANCE_KEYS);
  });

  it.each(['client', 'ziadatel'] as const)(
    'a %s gets nothing: their token is refused at /mcp',
    async (role) => {
      const person = await createUnverifiedClient(test.deps.db, `${randomUUID()}@example.com`);
      await addMembership(test.deps.db, person.id, groupId, role);
      const token = await mcpToken(test.deps.db, person.id);
      const res = await mcpRequest(test.app, token, 'tools/call', {
        name: 'list_finance_documents',
        arguments: { groupId },
      });
      expect(res.statusCode).toBe(403);
      expect(res.body).not.toContain(word);
    },
  );

  it('losing the right acts on the next call', async () => {
    const db = test.deps.db;
    const row = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Lost' });
    admins.push(row.id);
    await setFinanceAccess(db, row.id, row.id);
    const token = await mcpToken(db, row.id, 'read');
    expect(
      (await callTool(test.app, token, 'list_finance_document_folders', { groupId })).isError,
    ).toBe(false);
    await setFinanceAccess(db, row.id, null);
    const res = await callTool(test.app, token, 'list_finance_document_folders', { groupId });
    expect(res.json).toMatchObject({ status: 403 });
  });
});
