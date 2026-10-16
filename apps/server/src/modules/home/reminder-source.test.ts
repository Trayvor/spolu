import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { HomeReminder } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addAdmin } from '../users/service.js';
import { registerReminderSource, type ReminderSource } from './reminder-source.js';
import { newClient, newGroup } from './test-fixtures.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('GET /api/me/home/reminders', () => {
  let test: TestApp;
  let adminCookie: string;
  let clientCookie: string;

  beforeAll(async () => {
    test = await buildTestApp();
    const email = `${randomUUID()}@example.com`;
    await addAdmin(test.deps.db, { email, name: 'Rem Admin' });
    adminCookie = await loginAs(test.app, email);
    const group = await newGroup(test.deps.db);
    const client = await newClient(test.deps.db, group.id);
    clientCookie = await loginAs(test.app, client.email);
  });
  afterEach(() => registerReminderSource(null));
  afterAll(() => test.close());

  const get = (cookie: string) =>
    test.app.inject({ method: 'GET', url: '/api/me/home/reminders', headers: { cookie } });

  const item: HomeReminder = {
    id: 'time-1',
    at: '2026-10-21T07:00:00.000Z',
    title: 'Call the auditor',
    groupId: 'g1',
    groupName: 'ABC',
    target: { kind: 'knowledge', itemId: 'k1' },
  };

  it('no source answers available false', async () => {
    registerReminderSource(null);
    const res = await get(adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: false });
  });

  it('a fake source gives items and nextWeek', async () => {
    const source: ReminderSource = {
      upcoming: vi.fn(async () => [item]),
      countNextWeek: vi.fn(async () => 3),
    };
    registerReminderSource(source);
    const res = await get(adminCookie);
    expect(res.json()).toEqual({ available: true, nextWeek: 3, items: [item] });
    const [, actor, opts] = vi.mocked(source.upcoming).mock.calls[0]!;
    expect(actor.email).toBeDefined();
    expect(opts.limit).toBe(10);
    expect(Math.abs(opts.from.getTime() - Date.now())).toBeLessThan(10_000);
  });

  it('a throwing source answers error true with 200', async () => {
    registerReminderSource({
      upcoming: async () => [item],
      countNextWeek: async () => {
        throw new Error('down');
      },
    });
    const res = await get(adminCookie);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ available: true, nextWeek: 0, items: [], error: true });
  });

  it('a client gets 403', async () => {
    const res = await get(clientCookie);
    expect(res.statusCode).toBe(403);
  });
});
