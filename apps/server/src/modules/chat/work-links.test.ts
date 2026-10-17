import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import {
  MessagePageSchema,
  TaskSearchPageSchema,
  TicketListResponseSchema,
  type GroupChannel,
  type MessageDto,
} from '@spolu/shared';
import type { Server as SocketIOServer } from 'socket.io';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { insertTask } from '../../../test/tasks.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { tasks } from '../tasks/schema.js';
import { ticketAssignees, tickets } from '../tickets/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { selectMessages, toMessageDtos } from './dto.js';
import { emitMessage } from './events.js';
import { messageTaskLinks, messageTicketLinks, messages } from './schema.js';

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `w${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('tasks and tickets in chat messages (Phase 34)', () => {
  let test: TestApp;
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY } });
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const send = (channelId: string, cookie: string, body: object) =>
    call('POST', `/api/channels/${channelId}/messages`, cookie, {
      body: '',
      clientId: randomUUID(),
      ...body,
    });

  async function group() {
    const h = host();
    return {
      ...(await createGroup(db(), { name: 'Firma', egrantUrl: `https://${h}.egrant.sk` })),
      host: h,
    };
  }
  async function admin() {
    const email = newEmail();
    const a = await addAdmin(db(), { email, name: 'Ad Min' });
    admins.push(a.id);
    return { ...a, cookie: await loginAs(test.app, email) };
  }
  async function member(groupId: string, role: 'client' | 'ziadatel', name = 'Člen') {
    const c = await createUnverifiedClient(db(), newEmail());
    await db().update(user).set({ name }).where(eq(user.id, c.id));
    await addMembership(db(), c.id, groupId, role);
    return { ...c, name, cookie: await loginAs(test.app, c.email) };
  }
  async function ticket(g: { host: string }, email: string, subject = 'Chyba') {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: { subject, email, instance_url: `https://${g.host}.egrant.sk` },
    });
    return res.json<{ id: string }>().id;
  }
  const groupChat = async (groupId: string, cookie: string) =>
    (await call('GET', `/api/groups/${groupId}/chat`, cookie)).json<GroupChannel>().id;
  const ticketChat = async (ticketId: string, cookie: string) =>
    (await call('GET', `/api/tickets/${ticketId}/chat`, cookie)).json<GroupChannel>().id;
  const messagesOf = async (channelId: string, cookie: string) =>
    MessagePageSchema.parse(
      (await call('GET', `/api/channels/${channelId}/messages`, cookie)).json(),
    ).messages;

  it('a client attaches their group’s task and ticket; everyone sees live cards', async () => {
    const g = await group();
    const a = await admin();
    const client = await member(g.id, 'client', 'Klient');
    const taskId = await insertTask(db(), {
      groupId: g.id,
      createdBy: a.id,
      title: 'Opraviť rozpočet',
      dueDate: '2030-01-02',
      urgent: true,
      assignees: [client.id, a.id],
    });
    const ticketId = await ticket(g, newEmail(), 'Nejde prihlásenie');
    const channelId = await groupChat(g.id, a.cookie);

    // Work only: no text and no files is a valid message.
    const res = await send(channelId, client.cookie, { taskIds: [taskId], ticketIds: [ticketId] });
    expect(res.statusCode).toBe(201);
    const sent = res.json<MessageDto>();
    expect(sent.attachedTasks).toEqual([
      {
        id: taskId,
        available: true,
        groupId: g.id,
        title: 'Opraviť rozpočet',
        completed: false,
        bucketKind: 'todo',
        bucketName: null,
        assignees: [
          { id: a.id, name: 'Ad Min' },
          { id: client.id, name: 'Klient' },
        ],
        dueDate: '2030-01-02',
        urgent: true,
      },
    ]);
    expect(sent.attachedTickets).toMatchObject([
      { id: ticketId, available: true, groupId: g.id, subject: 'Nejde prihlásenie' },
    ]);

    // Live fields: the card follows the task and the ticket.
    await db().update(tasks).set({ completedAt: new Date() }).where(eq(tasks.id, taskId));
    await db().update(tickets).set({ status: 'resolved' }).where(eq(tickets.id, ticketId));
    for (const cookie of [a.cookie, client.cookie]) {
      const [m] = await messagesOf(channelId, cookie);
      expect(m!.attachedTasks[0]).toMatchObject({ completed: true });
      expect(m!.attachedTickets[0]).toMatchObject({ status: 'resolved' });
    }
  });

  it('refuses another client’s task or ticket and missing ones (400 invalid_attachment)', async () => {
    const g = await group();
    const other = await group();
    const a = await admin();
    const channelId = await groupChat(g.id, a.cookie);
    const foreignTask = await insertTask(db(), { groupId: other.id, createdBy: a.id });
    const foreignTicket = await ticket(other, newEmail());
    const ownTask = await insertTask(db(), { groupId: g.id, createdBy: a.id });

    for (const body of [
      { taskIds: [foreignTask] },
      { ticketIds: [foreignTicket] },
      { taskIds: [randomUUID()] },
      { ticketIds: [randomUUID()] },
      // One bad id spoils the message.
      { taskIds: [ownTask, foreignTask] },
    ]) {
      const res = await send(channelId, a.cookie, { body: 'Pozri', ...body });
      expect(res.statusCode, JSON.stringify(body)).toBe(400);
      expect(res.json()).toEqual({ error: 'invalid_attachment' });
    }
    expect(await messagesOf(channelId, a.cookie)).toEqual([]);
  });

  it('a client of another group cannot attach here, and a ziadatel never attaches (403)', async () => {
    const g = await group();
    const a = await admin();
    const z = await member(g.id, 'ziadatel', 'Žiadateľ');
    const outsider = await member((await group()).id, 'client');
    const taskId = await insertTask(db(), { groupId: g.id, createdBy: a.id });
    const own = await ticket(g, z.email);
    const channelId = await ticketChat(own, a.cookie);

    expect((await send(channelId, z.cookie, { ticketIds: [own] })).statusCode).toBe(403);
    expect((await send(channelId, z.cookie, { taskIds: [taskId] })).statusCode).toBe(403);
    // The outsider does not read the channel at all.
    expect((await send(channelId, outsider.cookie, { taskIds: [taskId] })).statusCode).toBe(404);
  });

  it('a deleted task, a deleted ticket and a ticket moved to another client show as unavailable', async () => {
    const g = await group();
    const other = await group();
    const a = await admin();
    const gone = await insertTask(db(), { groupId: g.id, createdBy: a.id });
    const goneTicket = await ticket(g, newEmail());
    const movedTicket = await ticket(g, newEmail());
    const channelId = await groupChat(g.id, a.cookie);
    await send(channelId, a.cookie, {
      taskIds: [gone],
      ticketIds: [goneTicket, movedTicket],
    });

    await db().delete(tasks).where(eq(tasks.id, gone));
    await db().delete(tickets).where(eq(tickets.id, goneTicket));
    await db().update(tickets).set({ groupId: other.id }).where(eq(tickets.id, movedTicket));
    const [m] = await messagesOf(channelId, a.cookie);
    expect(m!.attachedTasks).toEqual([{ id: gone, available: false }]);
    expect(m!.attachedTickets).toEqual([
      { id: goneTicket, available: false },
      { id: movedTicket, available: false },
    ]);
  });

  it('editing keeps the work (text can go); deleting the message drops the rows', async () => {
    const g = await group();
    const a = await admin();
    const taskId = await insertTask(db(), { groupId: g.id, createdBy: a.id });
    const channelId = await groupChat(g.id, a.cookie);
    const sent = (
      await send(channelId, a.cookie, { body: 'Pozri', taskIds: [taskId] })
    ).json<MessageDto>();
    const edited = await call('PATCH', `/api/messages/${sent.id}`, a.cookie, { body: '' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json<MessageDto>().attachedTasks).toHaveLength(1);
    expect((await call('DELETE', `/api/messages/${sent.id}`, a.cookie)).statusCode).toBe(204);
    expect((await messagesOf(channelId, a.cookie))[0]!.attachedTasks).toEqual([]);
    expect(
      await db().select().from(messageTaskLinks).where(eq(messageTaskLinks.messageId, sent.id)),
    ).toEqual([]);
  });

  it('a ziadatel’s copy drops the tasks and keeps only their own ticket', async () => {
    const g = await group();
    const a = await admin();
    const z = await member(g.id, 'ziadatel', 'Žiadateľ');
    const taskId = await insertTask(db(), { groupId: g.id, createdBy: a.id });
    const own = await ticket(g, z.email, 'Moje');
    const foreign = await ticket(g, newEmail(), 'Cudzie');
    const channelId = await ticketChat(own, a.cookie);
    const sent = (
      await send(channelId, a.cookie, {
        body: 'Pozri',
        taskIds: [taskId],
        ticketIds: [foreign, own],
      })
    ).json<MessageDto>();
    expect(sent.attachedTasks).toHaveLength(1);
    expect(sent.attachedTickets).toHaveLength(2);

    const fetched = (await messagesOf(channelId, z.cookie))[0]!;
    expect(fetched.attachedTasks).toEqual([]);
    expect(fetched.attachedTickets.map((t) => t.id)).toEqual([own]);
    // Admins in the same chat still see everything.
    const adminView = (await messagesOf(channelId, a.cookie))[0]!;
    expect(adminView.attachedTasks).toHaveLength(1);
    expect(adminView.attachedTickets).toHaveLength(2);
  });

  it('the room payloads: the group room gets all, the initiator’s room their copy', async () => {
    const g = await group();
    const a = await admin();
    const z = await member(g.id, 'ziadatel', 'Žiadateľ');
    const taskId = await insertTask(db(), { groupId: g.id, createdBy: a.id });
    const own = await ticket(g, z.email);
    const foreign = await ticket(g, newEmail());
    const channelId = await ticketChat(own, a.cookie);
    await send(channelId, a.cookie, { body: 'x', taskIds: [taskId], ticketIds: [foreign, own] });

    // The route computes the initiator's copy with the channel's rules; the emitter sends it.
    const sentTo: { rooms: unknown; except?: unknown; payload: { message: MessageDto } }[] = [];
    const io = {
      to(rooms: unknown) {
        return {
          emit: (_e: string, payload: { message: MessageDto }) => sentTo.push({ rooms, payload }),
          except: (except: unknown) => ({
            emit: (_e: string, payload: { message: MessageDto }) =>
              sentTo.push({ rooms, except, payload }),
          }),
        };
      },
    } as unknown as SocketIOServer;
    const [full] = await messagesOf(channelId, a.cookie);
    const channel = { groupId: g.id, taskId: null };
    emitMessage(io, channel, full!, true, ['user:z']);
    // Without a computed copy the extra rooms get no work at all (nothing leaks by default).
    const extra = sentTo.find((s) => s.except !== undefined)!;
    expect(extra.payload.message).toMatchObject({
      tasks: [],
      attachedTasks: [],
      attachedTickets: [],
    });
    expect(sentTo.find((s) => s.except === undefined)!.payload.message.attachedTasks).toHaveLength(
      1,
    );
  });

  it('cards of a page load in a fixed number of queries', async () => {
    const g = await group();
    const a = await admin();
    const channelId = await groupChat(g.id, a.cookie);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const t1 = await insertTask(db(), { groupId: g.id, createdBy: a.id, assignees: [a.id] });
      const t2 = await insertTask(db(), { groupId: g.id, createdBy: a.id });
      const k1 = await ticket(g, newEmail());
      const res = await send(channelId, a.cookie, { taskIds: [t1, t2], ticketIds: [k1] });
      ids.push(res.json<MessageDto>().id);
      await db().insert(ticketAssignees).values({ ticketId: k1, userId: a.id });
    }
    const counting = createCountingDb();
    try {
      const count = async (n: number) => {
        const rows = await selectMessages(counting.db, inArray(messages.id, ids.slice(0, n)), []);
        counting.reset();
        await toMessageDtos(counting.db, g.id, rows);
        return counting.count();
      };
      await count(5);
      expect(await count(5)).toBe(await count(1));
    } finally {
      await counting.close();
    }
  });

  it('GET /groups/:id/tasks/search: title fragment, open first, paged, readers only', async () => {
    const g = await group();
    const other = await group();
    const a = await admin();
    const client = await member(g.id, 'client');
    const z = await member(g.id, 'ziadatel');
    const outsider = await member(other.id, 'client');
    const done = await insertTask(db(), {
      groupId: g.id,
      createdBy: a.id,
      title: 'Rozpočet hotový',
      done: true,
    });
    const open = await insertTask(db(), { groupId: g.id, createdBy: a.id, title: 'Rozpočet 2026' });
    await insertTask(db(), { groupId: g.id, createdBy: a.id, title: 'Iná vec' });
    await insertTask(db(), { groupId: other.id, createdBy: a.id, title: 'Rozpočet cudzí' });

    const get = async (q: string, cookie = client.cookie, id = g.id) =>
      call('GET', `/api/groups/${id}/tasks/search?q=${encodeURIComponent(q)}`, cookie);
    const hit = TaskSearchPageSchema.parse((await get('rozpo')).json());
    expect(hit.items.map((t) => t.id)).toEqual([open, done]);
    expect(hit.next).toBeNull();
    expect(TaskSearchPageSchema.parse((await get('')).json()).items).toHaveLength(3);
    // A LIKE wildcard is text, not a pattern.
    expect(TaskSearchPageSchema.parse((await get('%%')).json()).items).toEqual([]);
    expect((await get('r')).statusCode).toBe(400);
    expect((await get('rozpo', outsider.cookie)).statusCode).toBe(404);
    expect((await get('rozpo', z.cookie)).statusCode).toBe(404);
    expect((await get('rozpo', a.cookie, randomUUID())).statusCode).toBe(404);

    // Paging: open ones first, then completed, no task twice.
    for (let i = 0; i < 24; i++) {
      await insertTask(db(), {
        groupId: g.id,
        createdBy: a.id,
        title: `Strana ${i}`,
        done: i % 2 === 0,
      });
    }
    const seen: string[] = [];
    let after: string | null = null;
    do {
      const res = await call(
        'GET',
        `/api/groups/${g.id}/tasks/search?q=Strana${after ? `&after=${after}` : ''}`,
        client.cookie,
      );
      const page = TaskSearchPageSchema.parse(res.json());
      expect(page.items.length).toBeLessThanOrEqual(20);
      seen.push(...page.items.map((t) => `${t.completed ? 'd' : 'o'}${t.id}`));
      after = page.next;
    } while (after);
    expect(seen).toHaveLength(24);
    expect(new Set(seen).size).toBe(24);
    expect(seen.map((s) => s[0]).join('')).toMatch(/^o+d+$/);
    expect(
      (await call('GET', `/api/groups/${g.id}/tasks/search?after=zzz`, client.cookie)).statusCode,
    ).toBe(400);
  });

  it('?q= on a group’s tickets: number, subject fragment, body start', async () => {
    const g = await group();
    const a = await admin();
    const t1 = await ticket(g, newEmail(), 'Nejde prihlásenie');
    await ticket(g, newEmail(), 'Iná vec');
    const [row] = await db().select().from(tickets).where(eq(tickets.id, t1));
    const list = async (q: string) =>
      TicketListResponseSchema.parse(
        (
          await call(
            'GET',
            `/api/groups/${g.id}/tickets?status=all&q=${encodeURIComponent(q)}`,
            a.cookie,
          )
        ).json(),
      ).items.map((t) => t.id);
    expect(await list('prihlás')).toEqual([t1]);
    expect(await list(String(row!.number))).toEqual([t1]);
    expect(await list(`#${row!.number}`)).toEqual([t1]);
    expect(await list('%%')).toEqual([]);
    expect(await list('')).toHaveLength(2);
    await db()
      .update(tickets)
      .set({ body: 'Dobrý deň, heslo nefunguje' })
      .where(eq(tickets.id, t1));
    expect(await list('dobrý deň')).toEqual([t1]);
    expect(await list('heslo')).toEqual([]);
    expect((await call('GET', `/api/groups/${g.id}/tickets?q=x`, a.cookie)).statusCode).toBe(400);
  });

  it('the rows reference the message and cascade', async () => {
    const g = await group();
    const a = await admin();
    const taskId = await insertTask(db(), { groupId: g.id, createdBy: a.id });
    const ticketId = await ticket(g, newEmail());
    const channelId = await groupChat(g.id, a.cookie);
    const sent = (
      await send(channelId, a.cookie, { taskIds: [taskId], ticketIds: [ticketId] })
    ).json<MessageDto>();
    expect(
      await db().select().from(messageTicketLinks).where(eq(messageTicketLinks.messageId, sent.id)),
    ).toEqual([{ messageId: sent.id, ticketId, position: 0 }]);
  });
});
