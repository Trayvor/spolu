import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { SocketEvents, type GroupJoinAck, type PingAck, type SessionUser } from '@spolu/shared';
import { getSessionFromHeaders } from '../../modules/auth/session.js';
import type { Auth } from '../../modules/auth/auth.js';
import type { Config } from '../config/config.js';
import { canReadGroup } from '../../modules/groups/policy.js';
import { getGroup, getMembershipGroupId } from '../../modules/groups/service.js';
import type { Db } from '../db/client.js';
import { groupRoom, sessionRoom, userRoom } from './rooms.js';

declare module 'socket.io' {
  interface SocketData {
    user: SessionUser;
    sessionId: string;
    /** The client's group; unset for admins. */
    groupId?: string;
    /** Group rooms the socket currently wants (added on `group:join`, removed on `group:leave`). */
    wantedGroups: Set<string>;
  }
}

/** The `groupId` of a `{ groupId }` payload: a string of 1..100 characters, else null. */
function parseGroupId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { groupId } = payload as { groupId?: unknown };
  return typeof groupId === 'string' && groupId.length >= 1 && groupId.length <= 100
    ? groupId
    : null;
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
      socket.data.wantedGroups = new Set();
      const rooms = [userRoom(found.user.id), sessionRoom(found.sessionId)];
      // A client joins their group's room; admins join group rooms with `group:join`.
      if (found.user.role === 'client') {
        const groupId = await getMembershipGroupId(db, found.user.id);
        if (groupId) {
          socket.data.groupId = groupId;
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
    // `ack` comes from the client: anything but a function is ignored, never called.
    const asAck = <T>(ack: unknown): ((reply: T) => void) | undefined =>
      typeof ack === 'function' ? (ack as (reply: T) => void) : undefined;

    socket.on(SocketEvents.ping, (ack?: unknown) => {
      asAck<PingAck>(ack)?.({ pong: true, at: new Date().toISOString() });
    });

    // Group rooms are joined after the same policy check as the HTTP routes; no data changes.
    socket.on(SocketEvents.groupJoin, async (payload: unknown, ackArg?: unknown) => {
      const ack = asAck<GroupJoinAck>(ackArg);
      const groupId = parseGroupId(payload);
      try {
        // Wanted before the awaits, so a `group:leave` that overtakes this join cancels it.
        if (groupId !== null) socket.data.wantedGroups.add(groupId);
        const allowed =
          groupId !== null &&
          canReadGroup(socket.data.user, groupId, socket.data.groupId ?? null) &&
          (await getGroup(db, groupId)) !== null;
        // The handshake snapshot of the user may be stale: read the session again.
        if (!allowed || !(await getSessionFromHeaders(auth, socket.request.headers))) {
          if (groupId !== null) socket.data.wantedGroups.delete(groupId);
          return ack?.({ ok: false, error: 'not_found' });
        }
        if (!socket.connected) return; // disconnected meanwhile: do not leave a stale room entry
        if (!socket.data.wantedGroups.has(groupId)) return ack?.({ ok: false, error: 'not_found' });
        await socket.join(groupRoom(groupId));
        ack?.({ ok: true });
      } catch (error) {
        app.log.error(error, 'group:join failed');
        try {
          ack?.({ ok: false, error: 'not_found' });
        } catch (ackError) {
          app.log.error(ackError, 'group:join ack failed');
        }
      }
    });

    socket.on(SocketEvents.groupLeave, async (payload: unknown, ackArg?: unknown) => {
      const ack = asAck<GroupJoinAck>(ackArg);
      try {
        const groupId = parseGroupId(payload);
        // A client never leaves their own group's room.
        if (groupId !== null && groupId !== socket.data.groupId) {
          socket.data.wantedGroups.delete(groupId);
          await socket.leave(groupRoom(groupId));
        }
        ack?.({ ok: true });
      } catch (error) {
        app.log.error(error, 'group:leave failed');
      }
    });
  });

  return io;
}
