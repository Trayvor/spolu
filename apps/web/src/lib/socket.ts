import { io, type Socket } from 'socket.io-client';

let socket: Socket | undefined;

/**
 * The one shared Socket.IO connection (same origin, `/socket.io`). Created on first use but
 * not connected: the server only accepts a handshake with a session, so the signed-in layout
 * calls `connectSocket()` once the session is known.
 *
 * WebSocket only: browsers omit `Origin` on same-origin polling GETs, and the server refuses a
 * handshake without the app `Origin` in production. A WebSocket handshake always sends it.
 */
export function getSocket(): Socket {
  socket ??= io({ path: '/socket.io', transports: ['websocket'], autoConnect: false });
  return socket;
}

export function connectSocket(): void {
  getSocket().connect();
}

/** Close the connection (logout, lost session). It stays closed until `connectSocket()`. */
export function disconnectSocket(): void {
  getSocket().disconnect();
}
