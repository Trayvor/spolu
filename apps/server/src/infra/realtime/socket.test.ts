import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import {
  AdminEvents,
  type AdminActivityEvent,
  GroupEvents,
  SocketEvents,
  TaskCreateSchema,
  type GroupJoinAck,
  type GroupManagersEvent,
  type PingAck,
} from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { ensureGroupChannel } from '../../modules/chat/service.js';
import { addMember, createGroup } from '../../modules/groups/service.js';
import { listBuckets } from '../../modules/tasks/service.js';
import { createTask } from '../../modules/tasks/task-service.js';
import { addAdmin } from '../../modules/users/service.js';
import { user } from '../../modules/users/schema.js';
import {
  ADMINS_ROOM,
  disconnectUser,
  emitToGroup,
  emitToGroupAdmins,
  groupAdminsRoom,
  userRoom,
} from './rooms.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

async function listen(test: TestApp): Promise<string> {
  await test.app.listen({ port: 0, host: '127.0.0.1' });
  const address = test.app.server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return `http://127.0.0.1:${address.port}`;
}

async function loggedIn(test: TestApp): Promise<{ id: string; cookie: string }> {
  const email = `${randomUUID()}@example.com`;
  const admin = await addAdmin(test.deps.db, { email, name: 'Socket Test' });
  return { id: admin.id, cookie: await loginAs(test.app, email) };
}

async function loggedInCookie(test: TestApp): Promise<string> {
  return (await loggedIn(test)).cookie;
}

function open(url: string, extraHeaders: Record<string, string> = {}): Socket {
  return connect(url, { transports: ['websocket'], extraHeaders, reconnection: false });
}

function nextEvent(socket: Socket, event: string): Promise<unknown> {
  return new Promise((resolve) => socket.once(event, resolve));
}

describe('socket.io', () => {
  let test: TestApp;
  let url: string;
  const sockets: Socket[] = [];
  const connectWith = (headers: Record<string, string>) => {
    const socket = open(url, headers);
    sockets.push(socket);
    return socket;
  };

  beforeAll(async () => {
    test = await buildTestApp();
    url = await listen(test);
  });
  afterAll(async () => {
    sockets.forEach((s) => s.close());
    await test.app.close();
    await test.close();
  });

  it('a socket without a session cookie gets connect_error "unauthorized"', async () => {
    const socket = connectWith({});
    const error = (await nextEvent(socket, 'connect_error')) as Error;
    expect(error.message).toBe('unauthorized');
  });

  it('a logged-in socket connects and gets the system:ping ack', async () => {
    const socket = connectWith({ cookie: await loggedInCookie(test) });
    await nextEvent(socket, 'connect');
    const ack: PingAck = await socket.emitWithAck(SocketEvents.ping);
    expect(ack.pong).toBe(true);
    expect(Math.abs(Date.now() - new Date(ack.at).getTime())).toBeLessThan(5000);
  });

  it('a disabled user gets connect_error "unauthorized"', async () => {
    const { id, cookie } = await loggedIn(test);
    await test.deps.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, id));
    const error = (await nextEvent(connectWith({ cookie }), 'connect_error')) as Error;
    expect(error.message).toBe('unauthorized');
  });

  it('a failing session lookup gets connect_error "server_error"', async () => {
    const cookie = await loggedInCookie(test);
    const lookup = vi
      .spyOn(test.app.auth.api, 'getSession')
      .mockRejectedValueOnce(new Error('database down'));
    const socket = connectWith({ cookie });
    const error = (await nextEvent(socket, 'connect_error')) as Error;
    lookup.mockRestore();
    expect(error.message).toBe('server_error');
  });

  it('a user disabled between session lookup and join is disconnected', async () => {
    const { id, cookie } = await loggedIn(test);
    const lookup = test.app.auth.api.getSession;
    const spy = vi
      .spyOn(test.app.auth.api, 'getSession')
      .mockImplementationOnce(async (...args) => {
        const result = await lookup(...args);
        await test.deps.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, id));
        return result;
      });
    const error = (await nextEvent(connectWith({ cookie }), 'connect_error')) as Error;
    spy.mockRestore();
    expect(error.message).toBe('unauthorized');
    expect(await test.app.io.in(userRoom(id)).fetchSockets()).toHaveLength(0);
  });

  it("sign-out disconnects only that session's sockets", async () => {
    const email = `${randomUUID()}@example.com`;
    await addAdmin(test.deps.db, { email, name: 'Two Sessions' });
    const cookieA = await loginAs(test.app, email);
    const cookieB = await loginAs(test.app, email);
    const a = connectWith({ cookie: cookieA });
    const b = connectWith({ cookie: cookieB });
    await Promise.all([a, b].map((s) => nextEvent(s, 'connect')));

    const closed = nextEvent(a, 'disconnect');
    const res = await test.app.inject({
      method: 'POST',
      url: '/api/auth/sign-out',
      headers: { cookie: cookieA, origin: 'http://localhost:3000' },
      payload: {},
    });
    expect(res.statusCode).toBe(200);
    await closed;
    expect(a.connected).toBe(false);
    expect(b.connected).toBe(true);
  });

  it('disconnectUser disconnects every socket of that user only', async () => {
    const { id: userId, cookie: cookieA } = await loggedIn(test);
    const cookieB = await loggedInCookie(test);
    const a1 = connectWith({ cookie: cookieA });
    const a2 = connectWith({ cookie: cookieA });
    const b = connectWith({ cookie: cookieB });
    await Promise.all([a1, a2, b].map((s) => nextEvent(s, 'connect')));

    const closed = Promise.all([nextEvent(a1, 'disconnect'), nextEvent(a2, 'disconnect')]);
    disconnectUser(test.app.io, userId);
    await closed;
    expect(a1.connected).toBe(false);
    expect(a2.connected).toBe(false);
    expect(b.connected).toBe(true);
  });

  describe('group rooms', () => {
    const newGroup = () =>
      createGroup(test.deps.db, {
        name: 'Rooms',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });

    async function clientCookie(groupId: string): Promise<string> {
      const email = `${randomUUID()}@example.com`;
      const id = randomUUID();
      await test.deps.db
        .insert(user)
        .values({ id, email, name: 'Room Client', role: 'client', emailVerified: true });
      await addMember(test.deps.db, groupId, id);
      return loginAs(test.app, email);
    }

    async function connected(cookie: string): Promise<Socket> {
      const socket = connectWith({ cookie });
      await nextEvent(socket, 'connect');
      return socket;
    }

    const join = (socket: Socket, payload: unknown): Promise<GroupJoinAck> =>
      socket.emitWithAck(SocketEvents.groupJoin, payload);

    /** Resolves true when `event` arrives within `ms`, else false. */
    const arrives = (socket: Socket, event: string, ms = 200) =>
      new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => {
          socket.off(event, onEvent);
          resolve(false);
        }, ms);
        const onEvent = () => {
          clearTimeout(timer);
          resolve(true);
        };
        socket.once(event, onEvent);
      });

    it('an admin joins any group room and receives emitToGroup events', async () => {
      const group = await newGroup();
      const admin = await connected(await loggedInCookie(test));
      expect(await join(admin, { groupId: group.id })).toEqual({ ok: true });
      const event = nextEvent(admin, 'test:event');
      emitToGroup(test.app.io, group.id, 'test:event', { n: 1 });
      expect(await event).toEqual({ n: 1 });
    });

    it('an admin disabled after connecting gets not_found on group:join', async () => {
      const group = await newGroup();
      const { id, cookie } = await loggedIn(test);
      const admin = await connected(cookie);
      await test.deps.db.update(user).set({ disabledAt: new Date() }).where(eq(user.id, id));
      expect(await join(admin, { groupId: group.id })).toEqual({ ok: false, error: 'not_found' });
    });

    it('an admin joining an unknown group gets not_found', async () => {
      const admin = await connected(await loggedInCookie(test));
      expect(await join(admin, { groupId: randomUUID() })).toEqual({
        ok: false,
        error: 'not_found',
      });
    });

    it('a malformed payload gets not_found', async () => {
      const admin = await connected(await loggedInCookie(test));
      for (const payload of [undefined, null, 'x', {}, { groupId: 5 }, { groupId: '' }]) {
        expect(await join(admin, payload)).toEqual({ ok: false, error: 'not_found' });
      }
      expect(await join(admin, { groupId: 'x'.repeat(101) })).toEqual({
        ok: false,
        error: 'not_found',
      });
    });

    it('a client joining another group gets not_found and receives none of its events', async () => {
      const mine = await newGroup();
      const other = await newGroup();
      const client = await connected(await clientCookie(mine.id));
      expect(await join(client, { groupId: other.id })).toEqual({ ok: false, error: 'not_found' });
      const got = arrives(client, 'test:event');
      emitToGroup(test.app.io, other.id, 'test:event', { n: 1 });
      expect(await got).toBe(false);
    });

    it('a client joining their own group gets ok', async () => {
      const group = await newGroup();
      const client = await connected(await clientCookie(group.id));
      expect(await join(client, { groupId: group.id })).toEqual({ ok: true });
    });

    it('group:leave of their own group keeps them in it', async () => {
      const group = await newGroup();
      const client = await connected(await clientCookie(group.id));
      const ack: GroupJoinAck = await client.emitWithAck(SocketEvents.groupLeave, {
        groupId: group.id,
      });
      expect(ack).toEqual({ ok: true });
      const got = arrives(client, 'test:event', 1000);
      emitToGroup(test.app.io, group.id, 'test:event', { n: 1 });
      expect(await got).toBe(true);
    });

    it('a leave that overtakes an in-flight join leaves the socket out of the room', async () => {
      const group = await newGroup();
      const admin = await connected(await loggedInCookie(test));
      const joined = join(admin, { groupId: group.id });
      await admin.emitWithAck(SocketEvents.groupLeave, { groupId: group.id });
      await joined;
      const got = arrives(admin, 'test:event');
      emitToGroup(test.app.io, group.id, 'test:event', { n: 1 });
      expect(await got).toBe(false);
    });

    it('a non-function ack never breaks the server', async () => {
      const group = await newGroup();
      const admin = await connected(await loggedInCookie(test));
      admin.emit(SocketEvents.ping, 5);
      admin.emit(SocketEvents.groupJoin, { groupId: group.id }, 5);
      admin.emit(SocketEvents.groupJoin, { groupId: 'nope' }, 'x');
      admin.emit(SocketEvents.groupLeave, { groupId: group.id }, 5);
      admin.emit(SocketEvents.groupLeave, { groupId: group.id }, {});
      const ack: PingAck = await admin.emitWithAck(SocketEvents.ping);
      expect(ack.pong).toBe(true);
    });

    it("an admin's group:join also joins the admins room; a client never does", async () => {
      const group = await newGroup();
      expect(groupAdminsRoom(group.id)).toBe(`group:${group.id}:admins`);
      const admin = await connected(await loggedInCookie(test));
      const client = await connected(await clientCookie(group.id));
      expect(await join(admin, { groupId: group.id })).toEqual({ ok: true });
      // A client's join of their own group must not add the admins room either.
      expect(await join(client, { groupId: group.id })).toEqual({ ok: true });
      const adminGot = nextEvent(admin, 'test:admins');
      const clientGot = arrives(client, 'test:admins', 500);
      emitToGroupAdmins(test.app.io, group.id, 'test:admins', { n: 1 });
      expect(await adminGot).toEqual({ n: 1 });
      expect(await clientGot).toBe(false);
      const rooms = await test.app.io.in(groupAdminsRoom(group.id)).fetchSockets();
      expect(rooms.map((s) => s.data.user.role)).toEqual(['admin']);

      // Leaving the group room leaves the admins room too.
      await admin.emitWithAck(SocketEvents.groupLeave, { groupId: group.id });
      const afterLeave = arrives(admin, 'test:admins');
      emitToGroupAdmins(test.app.io, group.id, 'test:admins', { n: 2 });
      expect(await afterLeave).toBe(false);
    });

    it('an admin leaves a group room and stops receiving its events', async () => {
      const group = await newGroup();
      const admin = await connected(await loggedInCookie(test));
      await join(admin, { groupId: group.id });
      await admin.emitWithAck(SocketEvents.groupLeave, { groupId: group.id });
      const got = arrives(admin, 'test:event');
      emitToGroup(test.app.io, group.id, 'test:event', { n: 1 });
      expect(await got).toBe(false);
    });
  });
  describe('group managers', () => {
    const clientIn = async (groupId: string) => {
      const email = `${randomUUID()}@example.com`;
      const id = randomUUID();
      await test.deps.db
        .insert(user)
        .values({ id, email, name: 'C', role: 'client', emailVerified: true });
      await addMember(test.deps.db, groupId, id);
      return { id, cookie: await loginAs(test.app, email) };
    };
    const put = (id: string, cookie: string) =>
      test.app.inject({ method: 'PUT', url: `/api/groups/${id}/managers/me`, headers: { cookie } });
    const connected = async (cookie: string) => {
      const socket = connectWith({ cookie });
      await nextEvent(socket, 'connect');
      return socket;
    };
    const collect = (socket: Socket) => {
      const got: GroupManagersEvent[] = [];
      socket.on(GroupEvents.managers, (e: GroupManagersEvent) => got.push(e));
      return got;
    };
    const settle = () => new Promise((r) => setTimeout(r, 150));

    it('an admin socket joins the admins room, a client socket does not', async () => {
      const g = await createGroup(test.deps.db, {
        name: 'G',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
      const admin = await loggedIn(test);
      const client = await clientIn(g.id);
      await connected(admin.cookie);
      await connected(client.cookie);
      const inRoom = await test.app.io.in(ADMINS_ROOM).fetchSockets();
      const ids = inRoom.map((s) => s.data.user.id);
      expect(ids).toContain(admin.id);
      expect(ids).not.toContain(client.id);
    });

    it('group:managers reaches the group room and the admins room, not a client of another group', async () => {
      const mk = () =>
        createGroup(test.deps.db, {
          name: 'G',
          egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
        });
      const [g, other] = [await mk(), await mk()];
      const admin = await loggedIn(test);
      const watcher = await loggedIn(test);
      const own = await clientIn(g.id);
      const foreign = await clientIn(other.id);
      const [adminSocket, watcherSocket, ownSocket, foreignSocket] = await Promise.all([
        connected(admin.cookie),
        connected(watcher.cookie),
        connected(own.cookie),
        connected(foreign.cookie),
      ]);
      const [a, w, o, f] = [adminSocket, watcherSocket, ownSocket, foreignSocket].map(collect) as [
        GroupManagersEvent[],
        GroupManagersEvent[],
        GroupManagersEvent[],
        GroupManagersEvent[],
      ];
      expect((await put(g.id, admin.cookie)).statusCode).toBe(200);
      await settle();
      const expected = { groupId: g.id, managers: [{ id: admin.id, name: 'Socket Test' }] };
      expect(a).toEqual([expected]);
      expect(w).toEqual([expected]);
      expect(o).toEqual([expected]);
      expect(f).toEqual([]);
    });

    it('an admin in the group room and the admins room gets the event once', async () => {
      const g = await createGroup(test.deps.db, {
        name: 'G',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
      const admin = await loggedIn(test);
      const socket = await connected(admin.cookie);
      const ack: GroupJoinAck = await socket.emitWithAck(SocketEvents.groupJoin, {
        groupId: g.id,
      });
      expect(ack.ok).toBe(true);
      const got = collect(socket);
      expect((await put(g.id, admin.cookie)).statusCode).toBe(200);
      await settle();
      expect(got).toHaveLength(1);
    });

    it('an unchanged PUT emits nothing', async () => {
      const g = await createGroup(test.deps.db, {
        name: 'G',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
      const admin = await loggedIn(test);
      const socket = await connected(admin.cookie);
      await put(g.id, admin.cookie);
      await settle();
      const got = collect(socket);
      expect((await put(g.id, admin.cookie)).statusCode).toBe(200);
      await settle();
      expect(got).toEqual([]);
    });
  });

  describe('admin:activity', () => {
    const mkGroup = () =>
      createGroup(test.deps.db, {
        name: 'Activity',
        egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
      });
    const clientIn = async (groupId: string) => {
      const email = `${randomUUID()}@example.com`;
      const id = randomUUID();
      await test.deps.db
        .insert(user)
        .values({ id, email, name: 'C', role: 'client', emailVerified: true });
      await addMember(test.deps.db, groupId, id);
      return { id, cookie: await loginAs(test.app, email) };
    };
    const connected = async (cookie: string) => {
      const socket = connectWith({ cookie });
      await nextEvent(socket, 'connect');
      return socket;
    };
    const collect = (socket: Socket) => {
      const got: AdminActivityEvent[] = [];
      socket.on(AdminEvents.activity, (e: AdminActivityEvent) => got.push(e));
      return got;
    };
    const settle = () => new Promise((r) => setTimeout(r, 150));

    it('admin:activity reaches admins only', async () => {
      const [g, other] = [await mkGroup(), await mkGroup()];
      const admin = await loggedIn(test);
      const own = await clientIn(g.id);
      const foreign = await clientIn(other.id);
      const sockets = await Promise.all([
        connected(admin.cookie),
        connected(own.cookie),
        connected(foreign.cookie),
      ]);
      const [a, o, f] = sockets.map(collect) as [
        AdminActivityEvent[],
        AdminActivityEvent[],
        AdminActivityEvent[],
      ];
      const channel = await ensureGroupChannel(test.deps.db, g.id);
      const res = await test.app.inject({
        method: 'POST',
        url: `/api/channels/${channel.id}/messages`,
        headers: { cookie: own.cookie, origin: 'http://localhost:3000' },
        payload: { body: 'hi', clientId: randomUUID() },
      });
      expect(res.statusCode).toBe(201);
      await settle();
      expect(a).toEqual([{ groupId: g.id, kind: 'chat' }]);
      expect(o).toEqual([]);
      expect(f).toEqual([]);
    });

    it('a task move sends kind task', async () => {
      const g = await mkGroup();
      const admin = await loggedIn(test);
      const socket = await connected(admin.cookie);
      const actor = { id: admin.id, email: 'x@example.com', name: 'A', role: 'admin' } as const;
      const task = await createTask(test.deps, actor, g.id, TaskCreateSchema.parse({ title: 'T' }));
      const review = (await listBuckets(test.deps.db, g.id)).find(
        (b) => b.kind === 'egrant_review',
      )!;
      const got = collect(socket);
      const res = await test.app.inject({
        method: 'POST',
        url: `/api/tasks/${task.id}/move`,
        headers: { cookie: admin.cookie, origin: 'http://localhost:3000' },
        payload: { bucketId: review.id, afterTaskId: null },
      });
      expect(res.statusCode).toBe(200);
      await settle();
      expect(got).toEqual([{ groupId: g.id, kind: 'task' }]);
    });

    it('deleting a custom bucket sends kind task (its tasks moved to To do)', async () => {
      const g = await mkGroup();
      const admin = await loggedIn(test);
      const socket = await connected(admin.cookie);
      const created = await test.app.inject({
        method: 'POST',
        url: `/api/groups/${g.id}/buckets`,
        headers: { cookie: admin.cookie, origin: 'http://localhost:3000' },
        payload: { name: 'Step' },
      });
      expect(created.statusCode).toBe(201);
      const got = collect(socket);
      const res = await test.app.inject({
        method: 'DELETE',
        url: `/api/buckets/${created.json<{ id: string }>().id}`,
        headers: { cookie: admin.cookie, origin: 'http://localhost:3000' },
      });
      expect(res.statusCode).toBe(204);
      await settle();
      expect(got).toEqual([{ groupId: g.id, kind: 'task' }]);
    });
  });
});

describe('socket.io in production', () => {
  it('a foreign or missing Origin is refused, the app origin is accepted', async () => {
    const test = await buildTestApp({
      config: { nodeEnv: 'production', publicUrl: 'http://localhost:3000' },
    });
    const url = await listen(test);
    const cookie = await loggedInCookie(test);
    const sockets = [
      open(url, { cookie, origin: 'http://evil.example' }),
      open(url, { cookie }),
      open(url, { cookie, origin: 'http://localhost:3000' }),
    ];
    try {
      const [foreign, missing, own] = sockets as [Socket, Socket, Socket];
      expect(((await nextEvent(foreign, 'connect_error')) as Error).message).toBe(
        'forbidden_origin',
      );
      expect(((await nextEvent(missing, 'connect_error')) as Error).message).toBe(
        'forbidden_origin',
      );
      await nextEvent(own, 'connect');
    } finally {
      sockets.forEach((s) => s.close());
      await test.app.close();
      await test.close();
    }
  });
});
