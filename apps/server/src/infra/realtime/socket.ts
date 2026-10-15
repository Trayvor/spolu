import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { SocketEvents, type PingAck, type SessionUser } from '@spolu/shared';
import { getSessionUserFromHeaders } from '../../modules/auth/session.js';
import type { Auth } from '../../modules/auth/auth.js';
import type { Config } from '../config/config.js';
import { userRoom } from './rooms.js';

declare module 'socket.io' {
  interface SocketData {
    user: SessionUser;
  }
}

/**
 * Attaches Socket.IO to the Fastify HTTP server. Sockets only push; writes go through HTTP.
 * Every socket is authenticated by the session cookie of the handshake and joins its user room.
 */
export function attachSocket(app: FastifyInstance, config: Config, auth: Auth): SocketIOServer {
  const appOrigin = new URL(config.publicUrl).origin;
  const io = new SocketIOServer(app.server, {
    path: '/socket.io',
    cors: { origin: config.nodeEnv === 'production' ? appOrigin : true },
  });

  io.use(async (socket, next) => {
    const { headers } = socket.request;
    // CORS does not stop a cross-site WebSocket handshake, so check the Origin ourselves.
    if (config.nodeEnv === 'production' && headers.origin !== appOrigin) {
      return next(new Error('forbidden_origin'));
    }
    try {
      const user = await getSessionUserFromHeaders(auth, headers);
      if (!user) return next(new Error('unauthorized'));
      socket.data.user = user;
      await socket.join(userRoom(user.id));
      next();
    } catch (error) {
      app.log.error(error, 'socket authentication failed');
      next(new Error('server_error')); // not the user's fault: the client may retry later
    }
  });

  io.on('connection', (socket) => {
    socket.on(SocketEvents.ping, (ack?: (payload: PingAck) => void) => {
      ack?.({ pong: true, at: new Date().toISOString() });
    });
  });

  return io;
}
