import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { and, eq, inArray } from 'drizzle-orm';
import {
  ChangesSchema,
  ChatEvents,
  MessagePageSchema,
  MessageReactionsSchema,
  ReactionPeopleSchema,
  type ChatReactionsEvent,
  type MessageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createCountingDb } from '../../../test/query-counter.js';
import { addMember, createGroup } from '../groups/service.js';
import { notificationEvents } from '../notifications/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';
import { selectMessages, toMessageDtos } from './dto.js';
import { messageReactions, messages } from './schema.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('chat reactions (Phase 28)', () => {
  let test: TestApp;
  let baseUrl: string;
  const sockets: Socket[] = [];
  const admins: string[] = [];

  beforeAll(async () => {
    test = await buildTestApp();
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

  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    cookie: string,
    payload?: object,
  ) => test.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });
  const react = (messageId: string, cookie: string, emoji: string, on = true) =>
    call('PUT', `/api/messages/${messageId}/reactions`, cookie, { emoji, on });

  async function clientIn(groupId: string, name: string) {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name, role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  /** A group chat with an admin, two clients and one message by the admin. */
  async function setup() {
    const group = await createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });
    const email = newEmail();
    const row = await addAdmin(test.deps.db, { email, name: 'Admin' });
    admins.push(row.id);
    const admin = { id: row.id, cookie: await loginAs(test.app, email) };
    const a = await clientIn(group.id, 'Anna');
    const b = await clientIn(group.id, 'Boris');
    const channelId = (await call('GET', `/api/groups/${group.id}/chat`, admin.cookie)).json<{
      id: string;
    }>().id;
    const sent = await call('POST', `/api/channels/${channelId}/messages`, admin.cookie, {
      body: 'Ahoj',
      clientId: randomUUID(),
    });
    return { group, admin, a, b, channelId, message: sent.json<MessageDto>() };
  }

  async function socketFor(cookie: string, groupId: string): Promise<Socket> {
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    await new Promise((resolve) => socket.emit('group:join', { groupId }, resolve));
    return socket;
  }

  const page = async (channelId: string, cookie: string) =>
    MessagePageSchema.parse(
      (await call('GET', `/api/channels/${channelId}/messages`, cookie)).json(),
    );

  it('PUT adds and removes the actor’s reaction; the page shows who reacted, in order', async () => {
    const s = await setup();
    const first = await react(s.message.id, s.a.cookie, '👍');
    expect(first.statusCode).toBe(200);
    const body = MessageReactionsSchema.parse(first.json());
    expect(body.reactions).toEqual([{ emoji: '👍', userIds: [s.a.id] }]);
    expect(body.changeSeq).toBeGreaterThan(s.message.changeSeq);

    await react(s.message.id, s.b.cookie, '❤️');
    await react(s.message.id, s.b.cookie, '👍');
    const [shown] = (await page(s.channelId, s.admin.cookie)).messages;
    expect(shown!.reactions).toEqual([
      { emoji: '👍', userIds: [s.a.id, s.b.id] },
      { emoji: '❤️', userIds: [s.b.id] },
    ]);
    // A reaction is no edit.
    expect(shown!.editedAt).toBeNull();

    const off = MessageReactionsSchema.parse(
      (await react(s.message.id, s.a.cookie, '👍', false)).json(),
    );
    // Emoji keep the order of their oldest reaction still there: Boris's ❤️ came first.
    expect(off.reactions).toEqual([
      { emoji: '❤️', userIds: [s.b.id] },
      { emoji: '👍', userIds: [s.b.id] },
    ]);
  });

  it('a repeated PUT changes nothing: same changeSeq, no event', async () => {
    const s = await setup();
    const once = MessageReactionsSchema.parse((await react(s.message.id, s.a.cookie, '😂')).json());
    const socket = await socketFor(s.admin.cookie, s.group.id);
    const events: ChatReactionsEvent[] = [];
    socket.on(ChatEvents.reactions, (e: ChatReactionsEvent) => events.push(e));
    const twice = MessageReactionsSchema.parse(
      (await react(s.message.id, s.a.cookie, '😂')).json(),
    );
    expect(twice).toEqual(once);
    const noop = MessageReactionsSchema.parse(
      (await react(s.message.id, s.a.cookie, '😮', false)).json(),
    );
    expect(noop.changeSeq).toBe(once.changeSeq);
    await new Promise((r) => setTimeout(r, 100));
    expect(events).toEqual([]);
  });

  it('pushes chat:reactions to the group room and records no notification', async () => {
    const s = await setup();
    const socket = await socketFor(s.b.cookie, s.group.id);
    const event = new Promise<ChatReactionsEvent>((resolve) =>
      socket.once(ChatEvents.reactions, resolve),
    );
    const res = MessageReactionsSchema.parse((await react(s.message.id, s.a.cookie, '🙏')).json());
    expect(await event).toEqual({
      groupId: s.group.id,
      channelId: s.channelId,
      taskId: null,
      messageId: s.message.id,
      parentId: null,
      changeSeq: res.changeSeq,
      reactions: [{ emoji: '🙏', userIds: [s.a.id] }],
    });
    const notices = await test.deps.db
      .select({ kind: notificationEvents.kind })
      .from(notificationEvents)
      .where(
        and(eq(notificationEvents.userId, s.admin.id), eq(notificationEvents.groupId, s.group.id)),
      );
    expect(notices).toEqual([]);
  });

  it('a reaction moves change_seq, so catch-up replays it', async () => {
    const s = await setup();
    const res = MessageReactionsSchema.parse((await react(s.message.id, s.a.cookie, '✅')).json());
    const changes = ChangesSchema.parse(
      (
        await call(
          'GET',
          `/api/channels/${s.channelId}/changes?afterSeq=${s.message.changeSeq}`,
          s.b.cookie,
        )
      ).json(),
    );
    expect(changes.messages.map((m) => [m.id, m.changeSeq, m.reactions])).toEqual([
      [s.message.id, res.changeSeq, [{ emoji: '✅', userIds: [s.a.id] }]],
    ]);
  });

  it('refuses a non-emoji (400), an unreadable message (404) and a deleted one (404)', async () => {
    const s = await setup();
    expect((await react(s.message.id, s.a.cookie, 'ok')).statusCode).toBe(400);
    expect((await react(s.message.id, s.a.cookie, '👍👍')).statusCode).toBe(400);
    const other = await createGroup(test.deps.db, { name: 'Iná', egrantUrl: newUrl() });
    const outsider = await clientIn(other.id, 'Cudzí');
    expect((await react(s.message.id, outsider.cookie, '👍')).statusCode).toBe(404);
    expect(
      (await call('GET', `/api/messages/${s.message.id}/reactions`, outsider.cookie)).statusCode,
    ).toBe(404);
    expect((await react('missing', s.a.cookie, '👍')).statusCode).toBe(404);

    await react(s.message.id, s.a.cookie, '👍');
    await call('DELETE', `/api/messages/${s.message.id}`, s.admin.cookie);
    expect((await react(s.message.id, s.b.cookie, '👍')).statusCode).toBe(404);
    const [shown] = (await page(s.channelId, s.a.cookie)).messages;
    expect(shown!.reactions).toEqual([]);
    const rows = await test.deps.db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.messageId, s.message.id));
    expect(rows).toEqual([]);
  });

  it('a message takes at most 20 different emoji; an existing one still adds people', async () => {
    const s = await setup();
    const emoji = [...'😀😁😂🤣😃😄😅😆😉😊😋😎😍😘🥰😗😙😚🙂🤗'];
    expect(emoji).toHaveLength(20);
    for (const e of emoji) expect((await react(s.message.id, s.a.cookie, e)).statusCode).toBe(200);
    expect((await react(s.message.id, s.a.cookie, '🤩')).statusCode).toBe(400);
    expect((await react(s.message.id, s.b.cookie, '😀')).statusCode).toBe(200);
  });

  it('GET /messages/:id/reactions names who reacted with each emoji', async () => {
    const s = await setup();
    await react(s.message.id, s.a.cookie, '👍');
    await react(s.message.id, s.admin.cookie, '👍');
    await react(s.message.id, s.b.cookie, '😢');
    const res = await call('GET', `/api/messages/${s.message.id}/reactions`, s.b.cookie);
    expect(res.statusCode).toBe(200);
    expect(ReactionPeopleSchema.parse(res.json())).toEqual([
      {
        emoji: '👍',
        people: [
          { id: s.a.id, name: 'Anna' },
          { id: s.admin.id, name: 'Admin' },
        ],
      },
      { emoji: '😢', people: [{ id: s.b.id, name: 'Boris' }] },
    ]);
  });

  it('reactions of a page load in a fixed number of queries', async () => {
    const s = await setup();
    const ids = [s.message.id];
    for (let i = 0; i < 5; i++) {
      const sent = await call('POST', `/api/channels/${s.channelId}/messages`, s.a.cookie, {
        body: `m${i}`,
        clientId: randomUUID(),
      });
      const id = sent.json<MessageDto>().id;
      ids.push(id);
      await react(id, s.b.cookie, '👍');
      await react(id, s.admin.cookie, '❤️');
    }
    const counting = createCountingDb();
    try {
      const count = async (n: number) => {
        const rows = await selectMessages(counting.db, inArray(messages.id, ids.slice(0, n)), []);
        counting.reset();
        await toMessageDtos(counting.db, s.group.id, rows);
        return counting.count();
      };
      // New pool connections first read the types: warm every one up before counting.
      await count(6);
      expect(await count(6)).toBe(await count(2));
    } finally {
      await counting.close();
    }
  });
});
