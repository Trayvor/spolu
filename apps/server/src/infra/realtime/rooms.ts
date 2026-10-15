import type { Server as SocketIOServer } from 'socket.io';

/** The room every socket of one user joins on connect. */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** Closes every socket of a user, e.g. after the user is removed. */
export function disconnectUser(io: SocketIOServer, userId: string): void {
  io.in(userRoom(userId)).disconnectSockets(true);
}
