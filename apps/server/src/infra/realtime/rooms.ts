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
