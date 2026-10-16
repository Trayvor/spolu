import type { Server as SocketIOServer } from 'socket.io';
import { AdminEvents, type AdminActivityEvent } from '@spolu/shared';

/** The room every socket of one user joins on connect. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** The room every socket of one login session joins on connect. */
export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
}

/** The room of every admin socket: it carries events about all groups, such as `group:managers`. */
export const ADMINS_ROOM = 'admins';

/**
 * Tells every admin socket that something changed in a group (`kind`: its chats or its tasks), so
 * the admin home's sidebar, dashboard and global board refetch. Clients never get it. Call after
 * the write commits, next to the group-room event.
 */
export function emitAdminActivity(io: SocketIOServer, event: AdminActivityEvent): void {
  io.to(ADMINS_ROOM).emit(AdminEvents.activity, event);
}

/** Every socket of the user joins the group's room, e.g. when a removed client is restored. */
export function joinGroupRoom(io: SocketIOServer, userId: string, groupId: string): void {
  io.in(userRoom(userId)).socketsJoin(groupRoom(groupId));
}

/** Every socket of the user leaves the group's rooms, e.g. when an admin removes them from it. */
export function leaveGroupRoom(io: SocketIOServer, userId: string, groupId: string): void {
  io.in(userRoom(userId)).socketsLeave([groupRoom(groupId), groupAdminsRoom(groupId)]);
}

/** Closes every socket of a user, e.g. after the user is removed. */
export function disconnectUser(io: SocketIOServer, userId: string): void {
  io.in(userRoom(userId)).disconnectSockets(true);
}

/** The room of one group: a client joins their own on connect, an admin joins any with `group:join`. */
export function groupRoom(groupId: string): string {
  return `group:${groupId}`;
}

/** Pushes an event to everyone in the group's room. Call after the transaction commits. */
export function emitToGroup(
  io: SocketIOServer,
  groupId: string,
  event: string,
  payload: unknown,
): void {
  io.to(groupRoom(groupId)).emit(event, payload);
}

/**
 * The admins of one group: an admin's socket joins it together with the group room on
 * `group:join`; a client's socket never does. Admins-only events go here, never to `groupRoom`.
 */
export function groupAdminsRoom(groupId: string): string {
  return `group:${groupId}:admins`;
}

/** Pushes an event to the admins in the group's admins room. Call after the transaction commits. */
export function emitToGroupAdmins(
  io: SocketIOServer,
  groupId: string,
  event: string,
  payload: unknown,
): void {
  io.to(groupAdminsRoom(groupId)).emit(event, payload);
}

/**
 * Pushes an event to the group room except the sockets also in its admins room: the clients of
 * the group. Call after the transaction commits.
 */
export function emitToGroupClients(
  io: SocketIOServer,
  groupId: string,
  event: string,
  payload: unknown,
): void {
  io.to(groupRoom(groupId)).except(groupAdminsRoom(groupId)).emit(event, payload);
}
