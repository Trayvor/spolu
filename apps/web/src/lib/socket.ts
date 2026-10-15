import { io, type Socket } from 'socket.io-client';

let socket: Socket | undefined;

/** The one shared Socket.IO connection (same origin, `/socket.io`). Created on first use. */
export function getSocket(): Socket {
  socket ??= io({ path: '/socket.io', autoConnect: true });
  return socket;
}
