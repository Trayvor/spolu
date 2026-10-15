import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { redirectToLogin } from './go-to-login';
import { clearSession, sessionQuery, useSession } from './use-session';

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/**
 * Layout of every signed-in screen. Owns the realtime connection: it opens once the session
 * is known and closes when the session goes (logout, 401) or the layout goes away. The server refuses a handshake without a
 * session with `unauthorized`: the session is gone, so go to /login (Socket.IO does not retry
 * after that error, and we do not either). `server_error` only means "try later": the user stays
 * signed in and the layout reconnects after 1 s, 2 s, 4 s ... up to 30 s (reset by a successful connect). When the server itself ends the connection (`io server disconnect`, e.g.
 * the admin was removed) Socket.IO does not reconnect, so ask /api/me: no session means
 * the same trip to /login.
 */
export function AuthedLayout() {
  const userId = useSession()?.id;
  const queryClient = useQueryClient();
  const router = useRouter();

  useEffect(() => {
    if (!userId) return;
    const socket = getSocket();
    // `server_error` ends the handshake and Socket.IO does not retry it: try again with backoff.
    let delay = RECONNECT_MIN_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function onConnect() {
      delay = RECONNECT_MIN_MS;
    }
    function onConnectError(error: Error) {
      if (error.message === 'server_error') {
        clearTimeout(timer);
        timer = setTimeout(connectSocket, delay);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
        return;
      }
      if (error.message !== 'unauthorized') return;
      clearSession(queryClient);
      void redirectToLogin(router);
    }
    async function onDisconnect(reason: string) {
      if (reason !== 'io server disconnect') return;
      try {
        const current = await queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
        if (current) return; // still signed in: the socket stays disconnected until a reload (no reconnect after a server-side disconnect)
      } catch {
        return; // /api/me is down: stay as we are, the next request will tell
      }
      clearSession(queryClient);
      void redirectToLogin(router);
    }
    socket.on('connect', onConnect);
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    connectSocket();
    return () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      disconnectSocket();
    };
  }, [userId, queryClient, router]);

  return <Outlet />;
}
