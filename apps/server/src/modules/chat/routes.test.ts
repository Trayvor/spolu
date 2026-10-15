import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import {
  AroundPageSchema,
  ChangesSchema,
  ChatEvents,
  GroupChannelSchema,
  MessagePageSchema,
  MessageSchema,
  ThreadSchema,
  UnreadThreadsSchema,
  mentionToken,
  type ChatMessageEvent,
  type ChatReadEvent,
  type ChatThreadReplyEvent,
  type MessageDto,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { createFile } from '../files/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser } from '../users/service.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

const newEmail = () => `${randomUUID()}@example.com`;
const newUrl = () => `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`;

describe('chat API', () => {
  let test: TestApp;
  let baseUrl: string;
  const sockets: Socket[] = [];

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    cookie: string,
    payload?: unknown,
  ) =>
    test.app.inject({
      method,
      url,
      headers: { cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });

  const send = (channelId: string, cookie: string, body: object = {}) =>
    call('POST', `/api/channels/${channelId}/messages`, cookie, {
      body: 'hello',
      clientId: randomUUID(),
      ...body,
    });

  async function adminSession() {
    const email = newEmail();
    const row = await addAdmin(test.deps.db, { email, name: 'Admin' });
    return { id: row.id, cookie: await loginAs(test.app, email) };
  }

  async function clientIn(groupId: string, name = 'Client') {
    const email = newEmail();
    const id = randomUUID();
    await test.deps.db
      .insert(user)
      .values({ id, email, name, role: 'client', emailVerified: true });
    await addMember(test.deps.db, groupId, id);
    return { id, cookie: await loginAs(test.app, email) };
  }

  /** A group with its chat channel, an admin and two clients. */
  async function setup() {
    const group = await createGroup(test.deps.db, { name: 'Firma', egrantUrl: newUrl() });
    const admin = await adminSession();
    const a = await clientIn(group.id, 'Anna');
    const b = await clientIn(group.id, 'Boris');
    const channelRes = await call('GET', `/api/groups/${group.id}/chat`, admin.cookie);
    return { group, admin, a, b, channelId: channelRes.json<{ id: string }>().id };
  }

  async function socketFor(cookie: string, groupId?: string): Promise<Socket> {
    const socket = connect(baseUrl, {
      transports: ['websocket'],
      extraHeaders: { cookie },
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve) => socket.once('connect', () => resolve(null)));
    if (groupId) {
      await new Promise((resolve) => socket.emit('group:join', { groupId }, resolve));
    }
    return socket;
  }

  const nextEvent = <T>(socket: Socket, event: string) =>
    new Promise<T>((resolve) => socket.once(event, resolve));

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    baseUrl = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  it('GET /api/groups/:id/chat creates the channel lazily and returns { id, lastSeq, lastReadAt: null, unread }', async () => {
    const group = await createGroup(test.deps.db, { name: 'Lazy', egrantUrl: newUrl() });
    const admin = await adminSession();
    const first = await call('GET', `/api/groups/${group.id}/chat`, admin.cookie);
    expect(first.statusCode).toBe(200);
    const channel = GroupChannelSchema.parse(first.json());
    expect(channel).toMatchObject({ lastSeq: 0, lastReadAt: null, unread: 0 });
    const again = await call('GET', `/api/groups/${group.id}/chat`, admin.cookie);
    expect(again.json<{ id: string }>().id).toBe(channel.id);
  });

  it('a client of another group gets 404 on every route', async () => {
    const s = await setup();
    const other = await createGroup(test.deps.db, { name: 'Other', egrantUrl: newUrl() });
    const outsider = await clientIn(other.id);
    const sent = await send(s.channelId, s.a.cookie);
    const messageId = sent.json<MessageDto>().id;
    const c = outsider.cookie;
    const results = await Promise.all([
      call('GET', `/api/groups/${s.group.id}/chat`, c),
      call('GET', `/api/channels/${s.channelId}/messages`, c),
      call('GET', `/api/channels/${s.channelId}/changes?afterSeq=0`, c),
      call('GET', `/api/messages/${messageId}/thread`, c),
      call('GET', `/api/messages/${messageId}/around`, c),
      send(s.channelId, c),
      call('PATCH', `/api/messages/${messageId}`, c, { body: 'x' }),
      call('DELETE', `/api/messages/${messageId}`, c),
      call('POST', `/api/channels/${s.channelId}/read`, c, { at: new Date().toISOString() }),
      call('GET', `/api/channels/${s.channelId}/unread-threads`, c),
      call('POST', `/api/messages/${messageId}/thread/read`, c),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual(Array(11).fill(404));
    expect(results[0]!.json()).toEqual({ error: 'not_found' });
  });

  it('admin sends, a client socket in the group room receives chat:message with isNew true', async () => {
    const s = await setup();
    const socket = await socketFor(s.a.cookie);
    const received = nextEvent<ChatMessageEvent>(socket, ChatEvents.message);
    const res = await send(s.channelId, s.admin.cookie, { body: 'hi all' });
    expect(res.statusCode).toBe(201);
    const event = await received;
    expect(event).toMatchObject({ groupId: s.group.id, channelId: s.channelId, isNew: true });
    expect(event.message.id).toBe(res.json<MessageDto>().id);
  });

  it('a repeated clientId answers 200 with the existing message and emits nothing', async () => {
    const s = await setup();
    const socket = await socketFor(s.a.cookie);
    const clientId = randomUUID();
    let events = 0;
    socket.on(ChatEvents.message, () => (events += 1));
    const first = await send(s.channelId, s.b.cookie, { clientId });
    expect(first.statusCode).toBe(201);
    const again = await send(s.channelId, s.b.cookie, { clientId });
    expect(again.statusCode).toBe(200);
    expect(again.json<MessageDto>().id).toBe(first.json<MessageDto>().id);
    // A later message proves the socket is live and the repeat pushed nothing before it.
    const marker = nextEvent(socket, ChatEvents.message);
    await send(s.channelId, s.b.cookie);
    await marker;
    // The first send and the marker; the repeat pushed nothing.
    expect(events).toBe(2);
  });

  it('a reply emits the reply and the parent', async () => {
    const s = await setup();
    const root = (await send(s.channelId, s.a.cookie)).json<MessageDto>();
    const socket = await socketFor(s.b.cookie);
    const events: ChatMessageEvent[] = [];
    const both = new Promise<void>((resolve) =>
      socket.on(ChatEvents.message, (e: ChatMessageEvent) => {
        events.push(e);
        if (events.length === 2) resolve();
      }),
    );
    const res = await send(s.channelId, s.b.cookie, { parentId: root.id, body: 'reply' });
    expect(res.statusCode).toBe(201);
    await both;
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ isNew: true });
    expect(events[0]!.message.parentId).toBe(root.id);
    expect(events[1]).toMatchObject({ isNew: false });
    expect(events[1]!.message).toMatchObject({ id: root.id, replyCount: 1 });
  });

  it('send with an invalid mention, another group file or a too-long body is rejected', async () => {
    const s = await setup();
    const mention = await send(s.channelId, s.a.cookie, { body: `hi ${mentionToken('nobody')}` });
    expect(mention.statusCode).toBe(400);
    expect(mention.json()).toEqual({ error: 'invalid_mention' });

    const other = await createGroup(test.deps.db, { name: 'Other', egrantUrl: newUrl() });
    const file = await createFile(
      { db: test.deps.db, storage: test.deps.storage },
      {
        groupId: other.id,
        uploadedBy: s.admin.id,
        name: 'a.txt',
        declaredType: 'text/plain',
        body: Readable.from([Buffer.from('a')]),
      },
    );
    const attachment = await send(s.channelId, s.a.cookie, { fileIds: [file.id] });
    expect(attachment.statusCode).toBe(400);
    expect(attachment.json()).toEqual({ error: 'invalid_attachment' });

    const long = await send(s.channelId, s.a.cookie, { body: 'x'.repeat(10_001) });
    expect(long.statusCode).toBe(400);
    expect(long.json()).toEqual({ error: 'validation_failed' });
    const empty = await send(s.channelId, s.a.cookie, { body: '   ' });
    expect(empty.statusCode).toBe(400);
  });

  it("edit and delete of someone else's message → 403; own edit works", async () => {
    const s = await setup();
    const msg = (await send(s.channelId, s.a.cookie)).json<MessageDto>();
    const edit = await call('PATCH', `/api/messages/${msg.id}`, s.b.cookie, { body: 'x' });
    expect(edit.statusCode).toBe(403);
    expect(edit.json()).toEqual({ error: 'forbidden' });
    expect((await call('DELETE', `/api/messages/${msg.id}`, s.b.cookie)).statusCode).toBe(403);

    const socket = await socketFor(s.b.cookie);
    const received = nextEvent<ChatMessageEvent>(socket, ChatEvents.message);
    const own = await call('PATCH', `/api/messages/${msg.id}`, s.a.cookie, { body: 'edited' });
    expect(own.statusCode).toBe(200);
    expect(MessageSchema.parse(own.json())).toMatchObject({ body: 'edited' });
    expect(await received).toMatchObject({ isNew: false });
    const bad = await call('PATCH', `/api/messages/${msg.id}`, s.a.cookie, {
      body: mentionToken('nobody'),
    });
    expect(bad.json()).toEqual({ error: 'invalid_mention' });
  });

  it('delete → 204, then the thread shows a deleted root with its replies; editing it → 404', async () => {
    const s = await setup();
    const root = (await send(s.channelId, s.a.cookie)).json<MessageDto>();
    await send(s.channelId, s.b.cookie, { parentId: root.id, body: 'reply' });
    const socket = await socketFor(s.b.cookie);
    const received = nextEvent<ChatMessageEvent>(socket, ChatEvents.message);
    const del = await call('DELETE', `/api/messages/${root.id}`, s.a.cookie);
    expect(del.statusCode).toBe(204);
    expect(await received).toMatchObject({ isNew: false });

    const thread = ThreadSchema.parse(
      (await call('GET', `/api/messages/${root.id}/thread`, s.b.cookie)).json(),
    );
    expect(thread.root.deletedAt).not.toBeNull();
    expect(thread.root.body).toBe('');
    expect(thread.replies).toHaveLength(1);
    const edit = await call('PATCH', `/api/messages/${root.id}`, s.a.cookie, { body: 'x' });
    expect(edit.statusCode).toBe(404);
    expect((await call('DELETE', `/api/messages/${root.id}`, s.a.cookie)).statusCode).toBe(204);
  });

  it("POST read emits chat:read to the user's other socket and unread becomes 0", async () => {
    const s = await setup();
    await send(s.channelId, s.a.cookie);
    const before = await call('GET', `/api/groups/${s.group.id}/chat`, s.b.cookie);
    expect(before.json<{ unread: number }>().unread).toBe(1);

    const socket = await socketFor(s.b.cookie);
    const received = nextEvent<ChatReadEvent>(socket, ChatEvents.read);
    const res = await call('POST', `/api/channels/${s.channelId}/read`, s.b.cookie, {
      at: new Date().toISOString(),
    });
    expect(res.statusCode).toBe(204);
    const event = await received;
    expect(event).toMatchObject({ groupId: s.group.id, channelId: s.channelId });
    const after = GroupChannelSchema.parse(
      (await call('GET', `/api/groups/${s.group.id}/chat`, s.b.cookie)).json(),
    );
    expect(after.unread).toBe(0);
    expect(after.lastReadAt).toBe(event.lastReadAt);
    const bad = await call('POST', `/api/channels/${s.channelId}/read`, s.b.cookie, {
      at: 'yesterday',
    });
    expect(bad.statusCode).toBe(400);
  });

  it("a reply counts for the thread's people: chat:thread-reply, unread threads, then thread read", async () => {
    const s = await setup();
    const root = (await send(s.channelId, s.a.cookie)).json<MessageDto>();
    await call('POST', `/api/channels/${s.channelId}/read`, s.a.cookie, {
      at: new Date().toISOString(),
    });
    const anna = await socketFor(s.a.cookie);
    const admin = await socketFor(s.admin.cookie);
    const adminEvents: unknown[] = [];
    admin.on(ChatEvents.threadReply, (e) => adminEvents.push(e));
    const announced = nextEvent<ChatThreadReplyEvent>(anna, ChatEvents.threadReply);
    await send(s.channelId, s.b.cookie, { parentId: root.id, body: 'reply' });
    expect(await announced).toEqual({
      groupId: s.group.id,
      channelId: s.channelId,
      rootId: root.id,
    });
    const chat = () => call('GET', `/api/groups/${s.group.id}/chat`, s.a.cookie);
    expect(GroupChannelSchema.parse((await chat()).json()).unread).toBe(1);
    const threads = await call('GET', `/api/channels/${s.channelId}/unread-threads`, s.a.cookie);
    expect(UnreadThreadsSchema.parse(threads.json())).toEqual([root.id]);

    const read = nextEvent<ChatReadEvent>(anna, ChatEvents.read);
    const res = await call('POST', `/api/messages/${root.id}/thread/read`, s.a.cookie);
    expect(res.statusCode).toBe(204);
    expect(await read).toMatchObject({
      groupId: s.group.id,
      channelId: s.channelId,
      rootId: root.id,
    });
    expect(GroupChannelSchema.parse((await chat()).json()).unread).toBe(0);
    const after = await call('GET', `/api/channels/${s.channelId}/unread-threads`, s.a.cookie);
    expect(after.json()).toEqual([]);
    // The admin is not in the thread: no event, and reading it is a quiet no-op.
    expect(adminEvents).toEqual([]);
    const outside = await call('POST', `/api/messages/${root.id}/thread/read`, s.admin.cookie);
    expect(outside.statusCode).toBe(204);
  });

  it('a removed member who took part in a thread gets no chat:thread-reply', async () => {
    const s = await setup();
    const root = (await send(s.channelId, s.a.cookie)).json<MessageDto>();
    await send(s.channelId, s.b.cookie, { parentId: root.id });
    const anna = await socketFor(s.a.cookie);
    const boris = await socketFor(s.b.cookie);
    const borisEvents: unknown[] = [];
    boris.on(ChatEvents.threadReply, (e) => borisEvents.push(e));
    // Removal without the socket disconnect, so only the recipient filter can keep him out.
    await deactivateUser(test.deps.db, s.b.id);
    const announced = nextEvent<ChatThreadReplyEvent>(anna, ChatEvents.threadReply);
    await send(s.channelId, s.admin.cookie, { parentId: root.id });
    await announced;
    // Both rooms get their emit in the same tick; one round trip later nothing more can arrive.
    await new Promise((resolve) => boris.emit('group:join', { groupId: s.group.id }, resolve));
    expect(borisEvents).toEqual([]);
  });

  it('GET /api/chat/unread: an admin sees every group, a client only their own', async () => {
    const s = await setup();
    const s2 = await setup();
    await send(s.channelId, s.a.cookie);
    await send(s2.channelId, s2.a.cookie);
    const admin = (await call('GET', '/api/chat/unread', s.admin.cookie)).json<
      Record<string, number>
    >();
    expect(admin[s.group.id]).toBe(1);
    expect(admin[s2.group.id]).toBe(1);
    const client = await call('GET', '/api/chat/unread', s.b.cookie);
    expect(client.json()).toEqual({ [s.group.id]: 1 });
  });

  it('input that Postgres would reject answers 400/404, never 500', async () => {
    const s = await setup();
    const c = s.a.cookie;
    const nul = '%00';
    const results = await Promise.all([
      call('POST', `/api/channels/${s.channelId}/read`, c, { at: '0000-01-01T00:00:00Z' }),
      send(s.channelId, c, { body: 'a\u0000b' }),
      send(s.channelId, c, { parentId: 'a\u0000b' }),
      send(s.channelId, c, { fileIds: ['a\u0000b'] }),
      call('PATCH', `/api/messages/x`, c, { body: 'a\u0000b' }),
      call('GET', `/api/channels/x${nul}/messages`, c),
      call('GET', `/api/messages/x${nul}/thread`, c),
      call('GET', `/api/groups/x${nul}/chat`, c),
      call('GET', `/api/channels/${s.channelId}/changes?afterSeq=99999999999`, c),
    ]);
    expect(results.map((r) => r.statusCode)).toEqual([400, 400, 400, 400, 404, 404, 404, 404, 400]);
  });

  it('the 31st send in a minute → 429 rate_limited', async () => {
    const s = await setup();
    for (let i = 0; i < 30; i += 1) {
      expect((await send(s.channelId, s.a.cookie, { body: `m${i}` })).statusCode).toBe(201);
    }
    const res = await send(s.channelId, s.a.cookie);
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
    // 31 sequential writes: generous under a loaded CI machine.
  }, 30_000);

  it('messages before/after, around, thread and changes return the shared shapes', async () => {
    const s = await setup();
    const sent: MessageDto[] = [];
    for (let i = 0; i < 4; i += 1) {
      sent.push((await send(s.channelId, s.a.cookie, { body: `m${i}` })).json<MessageDto>());
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const newest = MessagePageSchema.parse(
      (await call('GET', `/api/channels/${s.channelId}/messages?limit=2`, s.b.cookie)).json(),
    );
    expect(newest.messages.map((m) => m.body)).toEqual(['m3', 'm2']);
    expect(newest.hasMore).toBe(true);

    const last = newest.messages.at(-1)!;
    const cursor = encodeURIComponent(`${last.createdAt},${last.id}`);
    const older = MessagePageSchema.parse(
      (
        await call('GET', `/api/channels/${s.channelId}/messages?before=${cursor}`, s.b.cookie)
      ).json(),
    );
    expect(older.messages.map((m) => m.body)).toEqual(['m1', 'm0']);

    const first = sent[0]!;
    const afterCursor = encodeURIComponent(`${first.createdAt},${first.id}`);
    const forward = MessagePageSchema.parse(
      (
        await call('GET', `/api/channels/${s.channelId}/messages?after=${afterCursor}`, s.b.cookie)
      ).json(),
    );
    expect(forward.messages.map((m) => m.body)).toEqual(['m1', 'm2', 'm3']);

    const both = await call(
      'GET',
      `/api/channels/${s.channelId}/messages?before=${cursor}&after=${cursor}`,
      s.b.cookie,
    );
    expect(both.statusCode).toBe(400);
    const badCursor = await call(
      'GET',
      `/api/channels/${s.channelId}/messages?after=garbage`,
      s.b.cookie,
    );
    expect(badCursor.statusCode).toBe(400);
    expect(badCursor.json()).toEqual({ error: 'validation_failed' });

    const around = AroundPageSchema.parse(
      (await call('GET', `/api/messages/${sent[2]!.id}/around?limit=4`, s.b.cookie)).json(),
    );
    expect(around.targetId).toBe(sent[2]!.id);
    expect(around.messages.map((m) => m.body)).toContain('m2');

    const changes = ChangesSchema.parse(
      (await call('GET', `/api/channels/${s.channelId}/changes?afterSeq=2`, s.b.cookie)).json(),
    );
    expect(changes.messages.map((m) => m.body)).toEqual(['m2', 'm3']);
    expect(changes.truncated).toBe(false);
    expect(
      (await call('GET', `/api/channels/${s.channelId}/changes?afterSeq=-1`, s.b.cookie))
        .statusCode,
    ).toBe(400);
  });
});
