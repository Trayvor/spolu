import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { SocketEvents, type PingAck } from '@ehub/shared';
import type { Config } from '../config/config.js';

/** Attaches Socket.IO to the Fastify HTTP server. Sockets only push; writes go through HTTP. */
export function attachSocket(app: FastifyInstance, config: Config): SocketIOServer {
  const io = new SocketIOServer(app.server, {
    path: '/socket.io',
    cors: { origin: config.nodeEnv === 'production' ? config.publicUrl : true },
  });

  io.on('connection', (socket) => {
    socket.on(SocketEvents.ping, (ack?: (payload: PingAck) => void) => {
      ack?.({ pong: true, at: new Date().toISOString() });
    });
  });

  return io;
}
