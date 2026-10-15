import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Server as SocketIOServer } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { SocketEvents, type PingAck } from '@ehub/shared';
import { buildApp } from '../../app.js';
import { createDb } from '../db/client.js';
import { attachSocket } from './socket.js';
import { testConfig, testDatabaseUrl } from '../../../test/test-config.js';

describe('socket.io', () => {
  const config = testConfig();
  const { db, close } = createDb(testDatabaseUrl);
  let app: FastifyInstance;
  let io: SocketIOServer;
  let client: Socket;

  beforeAll(async () => {
    app = await buildApp({ config, db });
    io = attachSocket(app, config);
    await app.listen({ port: 0, host: '127.0.0.1' });
    const address = app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    client = connect(`http://127.0.0.1:${address.port}`, { transports: ['websocket'] });
  });
  afterAll(async () => {
    client.close();
    await io.close();
    await app.close();
    await close();
  });

  it('acks system:ping with pong and a current ISO timestamp', async () => {
    const ack: PingAck = await client.emitWithAck(SocketEvents.ping);
    expect(ack.pong).toBe(true);
    expect(Math.abs(Date.now() - new Date(ack.at).getTime())).toBeLessThan(5000);
  });
});
