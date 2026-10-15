import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { io as connect, type Socket } from 'socket.io-client';
import { SocketEvents, type PingAck } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { addAdmin } from '../../modules/users/service.js';
import { user } from '../../modules/users/schema.js';
import { disconnectUser, userRoom } from './rooms.js';

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
