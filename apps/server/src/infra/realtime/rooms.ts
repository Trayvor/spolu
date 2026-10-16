import type { Server as SocketIOServer } from 'socket.io';

/** The room every socket of one user joins on connect. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** The room every socket of one login session joins on connect. */
export function sessionRoom(sessionId: string): string {
  return `session:${sessionId}`;
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
