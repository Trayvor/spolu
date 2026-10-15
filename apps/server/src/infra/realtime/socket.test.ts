import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { SocketEvents, type PingAck } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';

describe('socket.io', () => {
  let test: Awaited<ReturnType<typeof buildTestApp>>;
  let client: Socket;

  beforeAll(async () => {
    test = await buildTestApp();
    await test.app.listen({ port: 0, host: '127.0.0.1' });
    const address = test.app.server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    client = connect(`http://127.0.0.1:${address.port}`, { transports: ['websocket'] });
  });
  afterAll(async () => {
    client.close();
    await test.app.close();
    await test.close();
  });

  it('acks system:ping with pong and a current ISO timestamp', async () => {
    const ack: PingAck = await client.emitWithAck(SocketEvents.ping);
    expect(ack.pong).toBe(true);
    expect(Math.abs(Date.now() - new Date(ack.at).getTime())).toBeLessThan(5000);
  });
});
