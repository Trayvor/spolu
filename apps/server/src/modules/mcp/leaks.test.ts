import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FileInfo } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { callTool, mcpRequest, mcpToken } from '../../../test/mcp.js';
import { insertTask } from '../../../test/tasks.js';
import { INTERNAL_CALL_HEADER } from '../auth/internal-calls.js';
import { createGroup } from '../groups/service.js';
import { addAdmin, deactivateUser, setFinanceAccess } from '../users/service.js';
import { ALLOWED_ROUTES, isAllowedRoute } from './allowlist.js';
import { createApiCaller, RouteNotAllowedError } from './call.js';
import { ALL_TOOLS } from './tools/index.js';

/**
 * The finance rule of MCP (spec §2 #5–6): documents only, read only, without money, and never
 * any other finance data, for any role; plus the allowlist and the internal-call header.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** Keys that carry money or time; none may appear in any MCP answer. */
const FINANCE_KEYS =
  /"(amount|amountMinor|currency|rateMinor|rate|rates|cost|costMinor|minutes|askTime|timeRequests|timeRequestCount|coveredByTasks|paid|toBePaid|balance)"\s*:/;

const FINANCE_ALLOWED = [
  'GET /api/groups/:id/finance/items',
  'GET /api/groups/:id/finance/folders',
  'GET /api/finance/items/:id',
];

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
      }).toEqual({
        route,
        exists: true,
      });
    }
  });

  it('its finance entries are exactly the three document reads', () => {
    const finance = ALLOWED_ROUTES.filter((r) => r.path.includes('finance')).map(
      (r) => `${r.method} ${r.path}`,
    );
    expect(finance.sort()).toEqual([...FINANCE_ALLOWED].sort());
  });

  it('holds no time, token, auth or delete route', () => {
    for (const route of ALLOWED_ROUTES) {
      expect(route.path).not.toMatch(
        /\/time(\/|$)|\/me\/mcp|\/auth|\/rates|\/work-log|\/overview|\/contracts|\/rankings|\/expenses/,
      );
      if (route.method === 'DELETE') {
        // Unassigning a riešiteľ is the only DELETE: it removes no entity.
        expect(route.path).toBe('/api/tickets/:id/assignees/:userId');
      }
    }
  });

  it.each([
    ['GET', '/api/finance/overview'],
    ['GET', '/api/finance/work-log'],
    ['GET', '/api/finance/contracts'],
    ['GET', '/api/finance/rates'],
    ['GET', '/api/finance/rankings/paid'],
    ['GET', '/api/groups/g1/finance/work-log'],
    ['GET', '/api/groups/g1/finance/overview'],
    ['POST', '/api/groups/g1/finance/items'],
    ['PATCH', '/api/finance/items/i1'],
    ['DELETE', '/api/finance/items/i1'],
    ['GET', '/api/tasks/t1/time'],
    ['GET', '/api/tickets/t1/time'],
    ['GET', '/api/me/mcp/tokens'],
    ['POST', '/api/me/mcp/tokens'],
    ['DELETE', '/api/tasks/t1'],
    ['GET', '/api/tasks/../finance/overview'],
    ['GET', '/api/tasks/t1%2F..%2Ffinance'],
  ])('refuses %s %s', async (method, path) => {
    expect(isAllowedRoute(method, path)).toBe(false);
    const api = createApiCaller(
      test.app,
      { id: 'x', email: 'x@example.com', name: 'X', role: 'superadmin', finance: true },
      '127.0.0.1',
    );
    await expect(api(method as 'GET', path)).rejects.toBeInstanceOf(RouteNotAllowedError);
  });

  it('every finance tool is marked finance and read only', () => {
    for (const tool of ALL_TOOLS.filter((t) => t.name.includes('finance'))) {
      expect({ name: tool.name, finance: tool.finance, write: tool.write ?? false }).toEqual({
        name: tool.name,
        finance: true,
        write: false,
      });
    }
  });

  it('the internal-call header from outside is no session', async () => {
    const res = await test.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { [INTERNAL_CALL_HEADER]: randomUUID() },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('MCP finance leaks', () => {
  let test: TestApp;
  let groupId: string;
  let contractId: string;
  let financeFileId: string;
  let taskId: string;
  let fin: { id: string; token: string };
  let plain: { id: string; token: string };
  let finCookie: string;
  const admins: string[] = [];
  const word = `Zmluva${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    test = await buildTestApp();
    const db = test.deps.db;
    const finEmail = `${randomUUID()}@example.com`;
    const finRow = await addAdmin(db, { email: finEmail, name: 'Fina' });
    const plainRow = await addAdmin(db, { email: `${randomUUID()}@example.com`, name: 'Pavol' });
    admins.push(finRow.id, plainRow.id);
    await setFinanceAccess(db, finRow.id, finRow.id);
    fin = { id: finRow.id, token: await mcpToken(db, finRow.id, 'write') };
    plain = { id: plainRow.id, token: await mcpToken(db, plainRow.id, 'write') };
    const cookie = await loginAs(test.app, finEmail);
    finCookie = cookie;
    const g = await createGroup(db, {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    groupId = g.id;
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
    // A rate, a manual entry and the admin's own task time: none may reach MCP.
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

  it('the check would see the amount: the app’s own answer has it', async () => {
    const res = await test.app.inject({
      method: 'GET',
      url: `/api/finance/items/${contractId}`,
      headers: { cookie: finCookie },
    });
    expect(res.body).toMatch(FINANCE_KEYS);
  });

  it('a finance admin reads the documents, without the amount', async () => {
    const list = await callTool(test.app, fin.token, 'list_finance_documents', { groupId });
    expect(list.isError).toBe(false);
    const page = list.json as { items: Array<Record<string, unknown>> };
    expect(page.items.map((i) => i.id)).toContain(contractId);
    expect(page.items.find((i) => i.id === contractId)?.contract).toEqual({
      contractNumber: `${word}-1`,
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
    });
    const one = await callTool(test.app, fin.token, 'get_finance_document', { itemId: contractId });
    expect(one.json).toMatchObject({ title: `${word} grant`, body: 'Signed copy attached.' });
    const search = await callTool(test.app, fin.token, 'list_finance_documents', {
      groupId,
      type: 'contract',
      q: word,
    });
    const folders = await callTool(test.app, fin.token, 'list_finance_folders', { groupId });
    for (const res of [list, one, search, folders]) {
      expect(res.raw).not.toMatch(FINANCE_KEYS);
      expect(res.raw).not.toContain('1234567');
      expect(res.raw).not.toContain('12345.67');
    }
  });

  it('a finance admin reads a finance document’s file', async () => {
    const res = await callTool(test.app, fin.token, 'read_file', { fileId: financeFileId });
    expect(res.isError).toBe(false);
    expect(res.content.map((c) => c.text).join('\n')).toContain(`${word} scan`);
  });

  it('no other answer of any tool carries money or time, for the finance admin', async () => {
    const reads: Array<[string, Record<string, unknown>]> = [
      ['whoami', {}],
      ['list_groups', {}],
      ['get_group', { groupId }],
      ['get_board', { groupId, done: 50 }],
      ['get_task', { taskId }],
      ['list_all_tasks', { clients: 'all', completed: true }],
      ['list_my_tasks', {}],
      ['list_tickets', { scope: 'all', status: 'all' }],
      ['list_knowledge', { scope: 'all', q: word }],
      ['list_knowledge', { groupId }],
      ['list_upcoming_reminders', {}],
      ['get_home_counts', {}],
      ['list_projects', { groupId }],
    ];
    for (const [name, args] of reads) {
      const res = await callTool(test.app, fin.token, name, args);
      expect({ name, error: res.isError, json: res.isError ? res.json : null }).toEqual({
        name,
        error: false,
        json: null,
      });
      expect({ name, leak: FINANCE_KEYS.exec(res.raw)?.[0] ?? null }).toEqual({ name, leak: null });
      expect({ name, word: res.raw.includes(`${word} manual`) }).toEqual({ name, word: false });
    }
    // Moving the task out of Completed and back: the answer drops `askTime`.
    const board = (await callTool(test.app, fin.token, 'get_board', { groupId })).json as {
      buckets: Array<{ id: string; kind: string }>;
    };
    const todo = board.buckets.find((b) => b.kind === 'todo')!;
    const moved = await callTool(test.app, fin.token, 'move_task', {
      taskId,
      bucketId: todo.id,
      afterTaskId: null,
    });
    expect(moved.isError).toBe(false);
    expect(moved.raw).not.toMatch(FINANCE_KEYS);
  });

  it('an admin without the right sees no finance tool and gets 403 by name', async () => {
    const list = await mcpRequest(test.app, plain.token, 'tools/list');
    expect(list.body).not.toContain('finance_');
    for (const [name, args] of [
      ['list_finance_documents', { groupId }],
      ['list_finance_folders', { groupId }],
      ['get_finance_document', { itemId: contractId }],
    ] as const) {
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

  it('losing the right acts on the next call', async () => {
    const db = test.deps.db;
    const email = `${randomUUID()}@example.com`;
    const row = await addAdmin(db, { email, name: 'Lost' });
    admins.push(row.id);
    await setFinanceAccess(db, row.id, row.id);
    const token = await mcpToken(db, row.id, 'read');
    expect((await callTool(test.app, token, 'list_finance_folders', { groupId })).isError).toBe(
      false,
    );
    await setFinanceAccess(db, row.id, null);
    const res = await callTool(test.app, token, 'list_finance_folders', { groupId });
    expect(res.json).toMatchObject({ status: 403 });
  });
});
