import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { SocketEvents, type PingAck, type SessionUser } from '@spolu/shared';
import { getSessionFromHeaders } from '../../modules/auth/session.js';
import type { Auth } from '../../modules/auth/auth.js';
import type { Config } from '../config/config.js';
import { getMembershipGroupId } from '../../modules/groups/service.js';
import type { Db } from '../db/client.js';
import { groupRoom, sessionRoom, userRoom } from './rooms.js';

declare module 'socket.io' {
  interface SocketData {
    user: SessionUser;
    sessionId: string;
  }
}

/**
 * Attaches Socket.IO to the Fastify HTTP server. Sockets only push; writes go through HTTP.
 * Every socket is authenticated by the session cookie of the handshake and joins its user room.
 */
export function attachSocket(
  app: FastifyInstance,
  config: Config,
  auth: Auth,
  db: Db,
): SocketIOServer {
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
      const found = await getSessionFromHeaders(auth, headers);
      if (!found) return next(new Error('unauthorized'));
      socket.data.user = found.user;
      socket.data.sessionId = found.sessionId;
      const rooms = [userRoom(found.user.id), sessionRoom(found.sessionId)];
      // A client joins their group's room; admins join no group rooms yet (Phase 4).
      if (found.user.role === 'client') {
        const groupId = await getMembershipGroupId(db, found.user.id);
        if (groupId) {
          socket.data.user = { ...found.user, groupId };
          rooms.push(groupRoom(groupId));
        }
      }
      await socket.join(rooms);
      // A user disabled (and disconnectUser run) between the lookup and the join would
      // otherwise keep this socket: check again now that the socket is in its rooms.
      if (!(await getSessionFromHeaders(auth, headers))) return next(new Error('unauthorized'));
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
