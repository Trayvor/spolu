import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { FinanceEvents } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { createEvent, createProject } from '../projects/service.js';
import { user } from '../users/schema.js';
import { addAdmin, setFinanceAccess } from '../users/service.js';
import { financeRates } from './schema.js';

/**
 * The leak guarantees of finance by project (Phase 33 P6, decision 25): a task's or ticket's
 * project change that moves time entries tells the finance room only; the projects module's
 * answers (a project, its events, the timeline) never carry money, hours or a contract, even for
 * a finance admin, since the projects module never reads finance.
 */
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;

describe('finance by project: leak guarantees (Phase 33 P6)', () => {
  let test: TestApp;
  let url: string;
  let superId: string;
  const sockets: Socket[] = [];

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT',
    path: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url: path, headers: { cookie }, ...(payload ? { payload } : {}) });

  async function adminSession(finance: boolean) {
    const email = newEmail();
    const admin = await addAdmin(db(), { email, name: finance ? 'Fin' : 'Plain' });
    if (finance) await setFinanceAccess(db(), admin.id, superId);
    return { id: admin.id, cookie: await loginAs(test.app, email) };
  }
  async function clientIn(groupId: string) {
    const email = newEmail();
    const id = randomUUID();
    await db()
      .insert(user)
      .values({ id, email, name: 'Client', role: 'client', emailVerified: true });
    await addMember(db(), groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }
  async function connected(cookie: string): Promise<Socket> {
    const socket = connect(url, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  beforeAll(async () => {
    test = await buildTestApp();
    superId = (await addAdmin(db(), { email: newEmail(), name: 'Granter' })).id;
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    url = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  it('a project change that moves time entries reaches the finance room only', async () => {
    const { id: groupId } = await createGroup(db(), {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const finance = await adminSession(true);
    const other = await adminSession(false);
    await addManager(db(), groupId, finance.id);
    await addManager(db(), groupId, other.id);
    const client = await clientIn(groupId);
    const p = (
      await createProject(db(), superId, groupId, { name: 'A', description: '', fileIds: [] })
    ).id;
    const q = (
      await createProject(db(), superId, groupId, { name: 'B', description: '', fileIds: [] })
    ).id;

    const created = await call('POST', `/api/groups/${groupId}/tasks`, other.cookie, {
      title: 'Práca',
      assigneeIds: [other.id],
      projectId: p,
    });
    const task = created.json<{ id: string; updatedAt: string }>();
    expect(
      (await call('PUT', `/api/tasks/${task.id}/time/me`, other.cookie, { minutes: 20 }))
        .statusCode,
    ).toBe(200);
    const fresh = (await call('GET', `/api/tasks/${task.id}`, other.cookie)).json<{
      updatedAt: string;
    }>();

    const got = { finance: 0, other: 0, client: 0 };
    for (const [key, session] of [
      ['finance', finance],
      ['other', other],
      ['client', client],
    ] as const) {
      const socket = await connected(session.cookie);
      if (key !== 'client') {
        await new Promise((resolve) => socket.emit('group:join', { groupId }, resolve));
      }
      socket.on(FinanceEvents.changed, () => (got[key] += 1));
    }
    const patched = await call('PATCH', `/api/tasks/${task.id}`, other.cookie, {
      projectId: q,
      updatedAt: fresh.updatedAt,
    });
    expect(patched.statusCode, patched.body).toBe(200);
    await new Promise((r) => setTimeout(r, 150));
    expect(got.finance).toBeGreaterThanOrEqual(1);
    expect({ other: got.other, client: got.client }).toEqual({ other: 0, client: 0 });
  });

  it('the projects module’s answers carry no money, hours or contract, even for a finance admin', async () => {
    const { id: groupId } = await createGroup(db(), {
      name: 'Firma',
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const finance = await adminSession(true);
    await addManager(db(), groupId, finance.id);
    await db()
      .insert(financeRates)
      .values({ id: randomUUID(), userId: finance.id, rateMinor: 6000, createdBy: superId });
    const p = (
      await createProject(db(), superId, groupId, { name: 'A', description: '', fileIds: [] })
    ).id;
    const e = (
      await createEvent(db(), superId, p, {
        name: 'E',
        description: '',
        occursOn: '2026-11-04',
        fileIds: [],
      })
    ).id;
    const made = await call('POST', `/api/groups/${groupId}/finance/items`, finance.cookie, {
      type: 'contract',
      title: 'Tajná zmluva',
      amount: { amountMinor: 4_242_00, currency: 'EUR' },
      startsOn: '2026-01-01',
      endsOn: '2026-12-31',
      projectId: p,
    });
    expect(made.statusCode, made.body).toBe(201);
    expect(
      (
        await call('POST', `/api/groups/${groupId}/finance/time-entries`, finance.cookie, {
          userId: finance.id,
          workedOn: '2026-03-03',
          minutes: 77,
          projectId: p,
          eventId: e,
        })
      ).statusCode,
    ).toBe(201);

    for (const path of [
      `/api/projects/${p}`,
      `/api/project-events/${e}`,
      `/api/groups/${groupId}/projects`,
      `/api/groups/${groupId}/timeline`,
    ]) {
      const res = await call('GET', path, finance.cookie);
      expect(res.statusCode, path).toBe(200);
      for (const word of ['Tajná', '424200', 'amountMinor', 'minutes', 'cost', 'rateMinor']) {
        expect(res.body.includes(word), `${path}: ${word}`).toBe(false);
      }
    }
  });
});
