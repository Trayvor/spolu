import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HOME_LIMITS, HomeUnseenSchema, NavCountsSchema, type HomeUnseen } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { recordNotifications } from '../notifications/service.js';
import { tickets } from '../tickets/schema.js';
import { newAdmin, newClient, newGroup, newTask } from './test-fixtures.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

/** 2026-11-01: the dashboard's Unseen card, `GET /me/home/unseen`. */
describe('GET /me/home/unseen', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(() => test.close());

  const get = (url: string, cookie: string) =>
    test.app.inject({ method: 'GET', url: `/api${url}`, headers: { cookie } });
  const unseen = async (cookie: string): Promise<HomeUnseen> => {
    const res = await get('/me/home/unseen', cookie);
    expect(res.statusCode).toBe(200);
    return HomeUnseenSchema.parse(res.json());
  };

  /** A ticket row written directly; `groupId` null: without a client. */
  async function newTicket(groupId: string | null, subject: string) {
    const id = randomUUID();
    const now = new Date();
    await test.deps.db.insert(tickets).values({
      id,
      groupId,
      status: 'new',
      source: 'manual',
      subject,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  const taskMoved = (groupId: string, taskId: string, recipient: string) =>
    recordNotifications(test.deps.db, {
      kind: 'task.moved',
      groupId,
      recipients: [recipient],
      payload: { taskId, groupId },
    });
  const ticketStatus = (groupId: string | null, ticketId: string, recipient: string) =>
    recordNotifications(test.deps.db, {
      kind: 'ticket.status',
      groupId,
      recipients: [recipient],
      payload: { ticketId, groupId, status: 'in_progress' },
    });

  it('a client gets 403, an anonymous caller 401', async () => {
    const group = await newGroup(test.deps.db, 'Unseen 403');
    const client = await newClient(test.deps.db, group.id);
    const res = await get('/me/home/unseen', await loginAs(test.app, client.email));
    expect(res.statusCode).toBe(403);
    const anon = await test.app.inject({ method: 'GET', url: '/api/me/home/unseen' });
    expect(anon.statusCode).toBe(401);
  });

  it('counts every unseen task and ticket, as the header does, newest change first', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Unseen card');
    const admin = await newAdmin(db, 'Una');
    const client = await newClient(db, group.id);
    const cookie = await loginAs(test.app, admin.email);
    // Not assigned to her: the card shows every unseen change, like the header count.
    const older = await newTask(db, { groupId: group.id, createdBy: client.id, title: 'Older' });
    const newer = await newTask(db, { groupId: group.id, createdBy: client.id, title: 'Newer' });
    const ticketId = await newTicket(group.id, 'Middle');
    const loose = await newTicket(null, 'Without client');
    await taskMoved(group.id, older, admin.id);
    await ticketStatus(group.id, ticketId, admin.id);
    await ticketStatus(null, loose, admin.id);
    await taskMoved(group.id, newer, admin.id);

    // Tickets without a client from parallel test files count for every admin: compare with the
    // header counts read just before and just after the card.
    for (;;) {
      const before = NavCountsSchema.parse((await get('/me/home/counts', cookie)).json());
      const card = await unseen(cookie);
      const after = NavCountsSchema.parse((await get('/me/home/counts', cookie)).json());
      if (before.tickets !== after.tickets || before.tasks !== after.tasks) continue;
      expect({ tasks: card.tasks, tickets: card.tickets }).toEqual({
        tasks: before.tasks,
        tickets: before.tickets,
      });
      expect(card.tasks).toBe(2);
      expect(card.tickets).toBeGreaterThanOrEqual(2);
      const mine = new Set<string>([older, newer, ticketId, loose]);
      const items = card.items.filter((i) => mine.has(i.id));
      expect(items.map((i) => i.title)).toEqual(['Newer', 'Without client', 'Middle', 'Older']);
      expect(items[0]).toMatchObject({
        kind: 'task',
        ticketNumber: null,
        groupId: group.id,
        groupName: 'Unseen card',
        unseen: 'change',
        summary: { lines: [{ kind: 'moved' }], more: 0 },
      });
      expect(items[1]).toMatchObject({
        kind: 'ticket',
        groupId: null,
        groupName: null,
        summary: { lines: [{ kind: 'status', status: 'in_progress' }], more: 0 },
      });
      expect(typeof items[1]!.ticketNumber).toBe('number');
      expect(new Date(items[0]!.changedAt) >= new Date(items[1]!.changedAt)).toBe(true);
      break;
    }
  });

  it('an item leaves the card once opened (marked seen)', async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Unseen seen');
    const admin = await newAdmin(db, 'Sid', [group.id]);
    const cookie = await loginAs(test.app, admin.email);
    const taskId = await newTask(db, { groupId: group.id, createdBy: admin.id, title: 'Open me' });
    await taskMoved(group.id, taskId, admin.id);
    expect((await unseen(cookie)).items.some((i) => i.id === taskId)).toBe(true);
    const seen = await test.app.inject({
      method: 'POST',
      url: `/api/tasks/${taskId}/seen`,
      headers: { cookie },
    });
    expect(seen.statusCode).toBe(204);
    const after = await unseen(cookie);
    expect(after.items.some((i) => i.id === taskId)).toBe(false);
    expect(after.tasks).toBe(0);
  });

  it(`lists at most ${HOME_LIMITS.unseen} items, counting them all`, async () => {
    const db = test.deps.db;
    const group = await newGroup(db, 'Unseen many');
    const admin = await newAdmin(db, 'Max');
    const cookie = await loginAs(test.app, admin.email);
    for (let i = 0; i <= HOME_LIMITS.unseen; i++) {
      const taskId = await newTask(db, { groupId: group.id, createdBy: admin.id });
      await taskMoved(group.id, taskId, admin.id);
    }
    const card = await unseen(cookie);
    expect(card.tasks).toBe(HOME_LIMITS.unseen + 1);
    expect(card.items).toHaveLength(HOME_LIMITS.unseen);
  });
});
