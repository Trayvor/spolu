import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  GroupChannel,
  MessageDto,
  MessagePage,
  TaskDetailDto,
  TaskProposals,
  TicketDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFakeProvider } from '../ai/fake-provider.js';
import { buildTicketSplitRequest } from '../ai/split.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { tasks } from '../tasks/schema.js';
import { getBoard } from '../tasks/service.js';
import { user } from '../users/schema.js';
import { addAdmin, createUnverifiedClient, deactivateUser } from '../users/service.js';
import { getTicketRow } from './service.js';

/** Part 21.5: a ticket (or a message of its chat) turned into tasks with the AI split. */

const KEY = 'test-tickets-key-0123456789';
type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const host = () => `k${randomUUID().replaceAll('-', '').slice(0, 20)}`;

describe('ticket to tasks (Phase 21.5)', () => {
  let test: TestApp;
  let baseUrl = '';
  const admins: string[] = [];
  const sockets: Socket[] = [];

  beforeAll(async () => {
    test = await buildTestApp({ config: { ticketsApiKey: KEY }, ai: createFakeProvider() });
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

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
  async function ticket(g: { host: string } | null, fields: Record<string, unknown> = {}) {
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/tickets/intake',
      headers: { authorization: `Bearer ${KEY}` },
      payload: {
        subject: 'Report',
        body: '- Write the report\n- Call the bank 2026-12-01',
        ...(g ? { instance_url: `https://${g.host}.egrant.sk` } : {}),
        ...fields,
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; number: number }>();
  }
  const card = (title: string) => ({
    title,
    description: '',
    assigneeIds: [],
    dueDate: null,
    urgent: false,
    fileIds: [],
    link: null,
  });
  const split = (ticketId: string, cookie: string) =>
    call('POST', `/api/tickets/${ticketId}/task-split`, cookie);
  const create = (groupId: string, ticketId: string, cookie: string, titles = ['A', 'B']) =>
    call('POST', `/api/groups/${groupId}/tasks/from-ticket`, cookie, {
      ticketId,
      tasks: titles.map(card),
    });

  describe('buildTicketSplitRequest', () => {
    const build = async (ticketId: string) =>
      buildTicketSplitRequest(
        db(),
        (await getTicketRow(db(), ticketId))!,
        new Date('2026-10-16T10:00:00Z'),
      );

    it('the text is the subject and the body, with no metadata block', async () => {
      const g = await group();
      const t = await ticket(g, {
        area: 'Granty',
        programme: 'Plán obnovy',
        due_date: '2026-11-20',
      });
      const request = await build(t.id);
      expect(request.source).toBe('ticket');
      expect(request.text).toBe('Report\n\n- Write the report\n- Call the bank 2026-12-01');
      expect(request.text).not.toContain(`#${t.number}`);
      expect(request.details).toEqual([
        { label: 'Area', value: 'Granty' },
        { label: 'Programme', value: 'Plán obnovy' },
      ]);
      expect(request.quoted).toBeNull();
      expect(request.conversation).toEqual([]);
      expect(request.today).toBe('2026-10-16');
    });

    it('carries the ticket chat, oldest first, without deleted messages, the newest 30', async () => {
      const g = await group();
      const a = await admin();
      const c = await member(g.id, 'client', 'Jana');
      const t = await ticket(g);
      const chat = (await call('GET', `/api/tickets/${t.id}/chat`, a.cookie)).json<GroupChannel>();
      const say = async (cookie: string, body: string) => {
        const res = await call('POST', `/api/channels/${chat.id}/messages`, cookie, {
          body,
          clientId: randomUUID(),
        });
        expect(res.statusCode).toBe(201);
        return res.json<MessageDto>();
      };
      await say(a.cookie, 'Dobrý deň, robili ste niečo predtým?');
      await say(c.cookie, 'Áno, nahrala som prílohu cez Chrome.');
      const gone = await say(c.cookie, 'preklep');
      expect((await call('DELETE', `/api/messages/${gone.id}`, c.cookie)).statusCode).toBeLessThan(
        300,
      );
      expect((await build(t.id)).conversation).toEqual([
        { author: 'Ad Min', text: 'Dobrý deň, robili ste niečo predtým?' },
        { author: 'Jana', text: 'Áno, nahrala som prílohu cez Chrome.' },
      ]);

      // Two authors: one may send 30 messages a minute.
      for (let i = 0; i < 30; i++) await say(i % 2 ? c.cookie : a.cookie, `m${i}`);
      const long = await build(t.id);
      expect(long.conversation).toHaveLength(30);
      expect(long.conversation.at(0)!.text).toBe('m0');
      expect(long.conversation.at(-1)!.text).toBe('m29');
    });
  });

  describe('POST /api/tickets/:id/task-split', () => {
    it("the ticket's due date is the proposed deadline unless the text gives one", async () => {
      const g = await group();
      const a = await admin();
      const t = await ticket(g, { due_date: '2026-11-20' });
      const res = await split(t.id, a.cookie);
      expect(res.statusCode).toBe(200);
      const { tasks: proposed } = res.json<TaskProposals>();
      expect(proposed.map((p) => [p.title, p.dueDate])).toEqual([
        ['Write the report', '2026-11-20'],
        ['Call the bank 2026-12-01', '2026-12-01'],
      ]);
    });

    it("a client of the ticket's group may split it", async () => {
      const g = await group();
      const c = await member(g.id, 'client');
      const t = await ticket(g);
      expect((await split(t.id, c.cookie)).statusCode).toBe(200);
    });

    it('ziadatel → 403', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const t = await ticket(g, { email: z.email });
      expect((await split(t.id, z.cookie)).statusCode).toBe(403);
    });

    it('ticket without client → 409 no_client', async () => {
      const a = await admin();
      const t = await ticket(null);
      const res = await split(t.id, a.cookie);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: 'no_client' });
    });

    it('an outsider or an unknown ticket → 404', async () => {
      const g = await group();
      const other = await group();
      const c = await member(other.id, 'client');
      const t = await ticket(g);
      expect((await split(t.id, c.cookie)).statusCode).toBe(404);
      expect((await split(randomUUID(), c.cookie)).statusCode).toBe(404);
    });
  });

  describe('POST /api/groups/:id/tasks/from-ticket', () => {
    it('creates the cards linked to the ticket, lists them on it and tells the followers', async () => {
      const g = await group();
      const a = await admin();
      const manager = await admin();
      await addManager(db(), g.id, manager.id);
      const t = await ticket(g);
      await call('PUT', `/api/tickets/${t.id}/follow`, manager.cookie);
      const res = await create(g.id, t.id, a.cookie);
      expect(res.statusCode).toBe(201);
      const created = res.json<{ tasks: TaskDetailDto[] }>().tasks;
      expect(created.map((c) => c.sourceTicket?.number)).toEqual([t.number, t.number]);

      const dto = (await call('GET', `/api/tickets/${t.id}`, a.cookie)).json<TicketDto>();
      expect(dto.taskCount).toBe(2);
      expect(dto.tasks?.map((x) => x.title)).toEqual(['A', 'B']);

      const events = await db()
        .select()
        .from(notificationEvents)
        .where(
          and(
            eq(notificationEvents.userId, manager.id),
            eq(notificationEvents.kind, 'ticket.tasks'),
          ),
        );
      expect(events.map((e) => (e.payload as { count: number }).count)).toEqual([2]);
    });

    it('editing, moving and deleting a task made from the ticket refresh the ticket', async () => {
      const g = await group();
      const a = await admin();
      const z = await member(g.id, 'ziadatel');
      const t = await ticket(g, { email: z.email });
      const [first, second] = (await create(g.id, t.id, a.cookie)).json<{
        tasks: TaskDetailDto[];
      }>().tasks;
      // The requester's own room hears only their tickets' events.
      const socket = connect(baseUrl, {
        transports: ['websocket'],
        extraHeaders: { cookie: z.cookie },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((resolve) => socket.once('connect', () => resolve(null)));
      const heard: string[] = [];
      socket.on('ticket:updated', (p: { ticketId: string }) => heard.push(p.ticketId));
      const next = async (n: number) => vi.waitFor(() => expect(heard).toHaveLength(n));

      const patched = await call('PATCH', `/api/tasks/${first!.id}`, a.cookie, {
        title: 'A renamed',
        updatedAt: first!.updatedAt,
      });
      expect(patched.statusCode).toBe(200);
      await next(1);
      const done = (await getBoard(db(), g.id)).buckets.find((b) => b.kind === 'done')!;
      const moved = await call('POST', `/api/tasks/${first!.id}/move`, a.cookie, {
        bucketId: done.id,
        afterTaskId: null,
      });
      expect(moved.statusCode).toBe(200);
      await next(2);
      expect((await call('DELETE', `/api/tasks/${second!.id}`, a.cookie)).statusCode).toBe(204);
      await next(3);
      expect(heard).toEqual([t.id, t.id, t.id]);

      const dto = (await call('GET', `/api/tickets/${t.id}`, a.cookie)).json<TicketDto>();
      expect(dto.tasks).toEqual([{ id: first!.id, title: 'A renamed', completed: true }]);
      // A refresh, not a change the followers hear about.
      const told = await db()
        .select()
        .from(notificationEvents)
        .where(
          and(eq(notificationEvents.userId, z.id), eq(notificationEvents.kind, 'ticket.tasks')),
        );
      expect(told).toHaveLength(1);
    });

    it('a client creates them; the ziadatel sees only the count', async () => {
      const g = await group();
      const c = await member(g.id, 'client');
      const z = await member(g.id, 'ziadatel');
      const t = await ticket(g, { email: z.email });
      expect((await create(g.id, t.id, c.cookie)).statusCode).toBe(201);
      const forClient = (await call('GET', `/api/tickets/${t.id}`, c.cookie)).json<TicketDto>();
      expect(forClient.tasks).toHaveLength(2);
      const forZ = (await call('GET', `/api/tickets/${t.id}`, z.cookie)).json<TicketDto>();
      expect(forZ.taskCount).toBe(2);
      expect(forZ.tasks).toBeNull();
    });

    it('a ziadatel cannot create, nor anyone for a ticket of another group', async () => {
      const g = await group();
      const other = await group();
      const a = await admin();
      const z = await member(g.id, 'ziadatel');
      const t = await ticket(g, { email: z.email });
      expect((await create(g.id, t.id, z.cookie)).statusCode).toBe(404);
      expect((await create(other.id, t.id, a.cookie)).statusCode).toBe(404);
      const rows = await db().select().from(tasks).where(eq(tasks.sourceTicketId, t.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe('a ticket chat message', () => {
    async function chatOf(ticketId: string, cookie: string) {
      return (await call('GET', `/api/tickets/${ticketId}/chat`, cookie)).json<GroupChannel>();
    }
    async function say(channelId: string, cookie: string, body: string) {
      const res = await call('POST', `/api/channels/${channelId}/messages`, cookie, {
        body,
        clientId: randomUUID(),
      });
      expect(res.statusCode).toBe(201);
      return res.json<MessageDto>();
    }

    it('a ticket chat message split links both message and ticket', async () => {
      const g = await group();
      const a = await admin();
      const t = await ticket(g);
      const channel = await chatOf(t.id, a.cookie);
      const message = await say(channel.id, a.cookie, '- One\n- Two');
      const res = await call('POST', `/api/groups/${g.id}/tasks/from-message`, a.cookie, {
        messageId: message.id,
        tasks: [card('One')],
      });
      expect(res.statusCode).toBe(201);
      const [row] = await db().select().from(tasks).where(eq(tasks.sourceTicketId, t.id));
      expect(row?.sourceMessageId).toBe(message.id);
      const dto = (await call('GET', `/api/tickets/${t.id}`, a.cookie)).json<TicketDto>();
      expect(dto.taskCount).toBe(1);
    });

    it('a ziadatel cannot ask the AI to split a message of their ticket chat', async () => {
      const g = await group();
      const z = await member(g.id, 'ziadatel');
      const t = await ticket(g, { email: z.email });
      const channel = await chatOf(t.id, z.cookie);
      const message = await say(channel.id, z.cookie, '- One');
      const res = await call('POST', `/api/messages/${message.id}/task-split`, z.cookie);
      expect(res.statusCode).toBe(403);
    });

    it("a ziadatel reads the chat without the messages' task links", async () => {
      const g = await group();
      const a = await admin();
      const z = await member(g.id, 'ziadatel');
      const t = await ticket(g, { email: z.email });
      const channel = await chatOf(t.id, a.cookie);
      const message = await say(channel.id, z.cookie, '- One');
      await call('POST', `/api/groups/${g.id}/tasks/from-message`, a.cookie, {
        messageId: message.id,
        tasks: [card('Secret title')],
      });
      const forAdmin = (
        await call('GET', `/api/channels/${channel.id}/messages`, a.cookie)
      ).json<MessagePage>();
      expect(forAdmin.messages[0]!.tasks).toHaveLength(1);
      for (const url of [
        `/api/channels/${channel.id}/messages`,
        `/api/channels/${channel.id}/changes?afterSeq=0`,
        `/api/messages/${message.id}/around`,
      ]) {
        const body = (await call('GET', url, z.cookie)).body;
        expect(body).toContain(message.id);
        expect(body).not.toContain('Secret title');
      }
      const thread = (await call('GET', `/api/messages/${message.id}/thread`, z.cookie)).body;
      expect(thread).not.toContain('Secret title');
    });

    it("a ziadatel's socket gets an edited message without its task links", async () => {
      const g = await group();
      const a = await admin();
      const z = await member(g.id, 'ziadatel');
      const t = await ticket(g, { email: z.email });
      const channel = await chatOf(t.id, a.cookie);
      const message = await say(channel.id, a.cookie, '- One');
      await call('POST', `/api/groups/${g.id}/tasks/from-message`, a.cookie, {
        messageId: message.id,
        tasks: [card('Secret title')],
      });
      const socket = connect(baseUrl, {
        transports: ['websocket'],
        extraHeaders: { cookie: z.cookie },
        reconnection: false,
      });
      sockets.push(socket);
      await new Promise((resolve) => socket.once('connect', () => resolve(null)));
      const got = new Promise<{ message: MessageDto }>((resolve) =>
        socket.once('chat:message', resolve),
      );
      const edited = await call('PATCH', `/api/messages/${message.id}`, a.cookie, {
        body: '- One, edited',
      });
      expect(edited.statusCode).toBe(200);
      expect(edited.json<MessageDto>().tasks).toHaveLength(1);
      const event = await got;
      expect(event.message.body).toBe('- One, edited');
      expect(event.message.tasks).toEqual([]);
    });
  });
});
