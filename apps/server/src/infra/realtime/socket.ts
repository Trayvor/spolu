import type { FastifyInstance } from 'fastify';
import { Server as SocketIOServer } from 'socket.io';
import { SocketEvents, type GroupJoinAck, type PingAck, type SessionUser } from '@spolu/shared';
import { getSessionFromHeaders } from '../../modules/auth/session.js';
import type { Auth } from '../../modules/auth/auth.js';
import type { Config } from '../config/config.js';
import { isAdmin } from '../../modules/users/policy.js';
import { canReadGroup } from '../../modules/groups/policy.js';
import { getGroup } from '../../modules/groups/service.js';
import { clientGroupIds } from '../../modules/groups/memberships.js';
import { FINANCE_ROOM } from '../../modules/finance/events.js';
import { canSeeFinance } from '../../modules/finance/policy.js';
import type { Db } from '../db/client.js';
import { ADMINS_ROOM, groupAdminsRoom, groupRoom, sessionRoom, userRoom } from './rooms.js';

declare module 'socket.io' {
  interface SocketData {
    user: SessionUser;
    sessionId: string;
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
      if (isAdmin(found.user)) rooms.push(ADMINS_ROOM);
      // Finance events (Phase 32) reach only finance admins; the grant routes move sockets later.
      if (canSeeFinance(found.user)) rooms.push(FINANCE_ROOM);
      // A client joins the rooms of all their client groups (never an admins room; a ziadatel
      // membership gives none); admins join group rooms and their admins rooms with `group:join`.
      if (found.user.role === 'client') {
        for (const groupId of await clientGroupIds(db, found.user.id))
          rooms.push(groupRoom(groupId));
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
          canReadGroup(
            socket.data.user,
            groupId,
            isAdmin(socket.data.user) ? [] : await clientGroupIds(db, socket.data.user.id),
          ) &&
          (await getGroup(db, groupId)) !== null;
        // The handshake snapshot of the user may be stale: read the session again.
        if (!allowed || !(await getSessionFromHeaders(auth, socket.request.headers))) {
          if (groupId !== null) socket.data.wantedGroups.delete(groupId);
          return ack?.({ ok: false, error: 'not_found' });
        }
        if (!socket.connected) return; // disconnected meanwhile: do not leave a stale room entry
        if (!socket.data.wantedGroups.has(groupId)) return ack?.({ ok: false, error: 'not_found' });
        // An admin also joins the group's admins room (admins-only events); a client never does.
        await socket.join(
          isAdmin(socket.data.user)
            ? [groupRoom(groupId), groupAdminsRoom(groupId)]
            : groupRoom(groupId),
        );
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
        // A client never leaves their groups' rooms: they hold only those, joined on connect,
        // and leave one only when an admin removes them (`leaveGroupRoom`).
        if (groupId !== null && isAdmin(socket.data.user)) {
          socket.data.wantedGroups.delete(groupId);
          await socket.leave(groupRoom(groupId));
          await socket.leave(groupAdminsRoom(groupId));
        }
        ack?.({ ok: true });
      } catch (error) {
        app.log.error(error, 'group:leave failed');
      }
    });
  });

  return io;
}
