import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileInfo, SessionUser } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpRequest, mcpToken } from '../../../test/mcp.js';
import { insertTask } from '../../../test/tasks.js';
import { INTERNAL_CALL_HEADER } from '../auth/internal-calls.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import {
  addAdmin,
  createUnverifiedClient,
  deactivateUser,
  setFinanceAccess,
} from '../users/service.js';
import { ALLOWED_ROUTES, isAllowedRoute } from './allowlist.js';
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
      const api = createApiCaller(test.app, user, '127.0.0.1');
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
    const api = createApiCaller(test.app, superadmin, '127.0.0.1');
    await expect(api(method as 'GET', path)).rejects.toBeInstanceOf(RouteNotAllowedError);
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
  });

  it('a read-only token of a finance admin reads but cannot write finance', async () => {
    const list = await mcpRequest(test.app, fin.readToken, 'tools/list');
    expect(list.body).toContain('list_rates');
    expect(list.body).not.toContain('add_rate');
    const res = await callTool(test.app, fin.readToken, 'add_rate', {
      rate: { userId: fin.id, rateMinor: 1, effectiveFrom: null },
    });
    expect(res.json).toMatchObject({ status: 403, detail: 'read-only token' });
  });

  it('an admin without the right sees no finance tool and gets 403 from each', async () => {
    const list = await mcpRequest(test.app, plain.token, 'tools/list');
    for (const [name] of financeCalls()) expect(list.body).not.toContain(`"${name}"`);
    for (const [name, args] of [
      ...financeCalls(),
      ['create_finance_document', { groupId, item: { type: 'note', title: 'x' } }],
      ['add_rate', { rate: { userId: plain.id, rateMinor: 1, effectiveFrom: null } }],
      ['set_my_task_time', { taskId, time: { minutes: 1 } }],
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
    expect((await callTool(test.app, token, 'list_finance_document_folders', { groupId })).isError).toBe(
      false,
    );
    await setFinanceAccess(db, row.id, null);
    const res = await callTool(test.app, token, 'list_finance_document_folders', { groupId });
    expect(res.json).toMatchObject({ status: 403 });
  });
});
