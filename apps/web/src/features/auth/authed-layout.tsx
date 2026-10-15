import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { redirectToLogin } from './go-to-login';
import { clearSession, sessionQuery, useSession } from './use-session';

/**
 * Layout of every signed-in screen. Owns the realtime connection: it opens once the session
 * is known and closes when the session goes (logout, 401) or the layout goes away. The server refuses a handshake without a
 * session with `unauthorized`: the session is gone, so go to /login (Socket.IO does not retry
 * after that error, and we do not either). `server_error` only means "try later", the user
 * stays signed in. When the server itself ends the connection (`io server disconnect`, e.g.
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
    function onConnectError(error: Error) {
      if (error.message !== 'unauthorized') return;
      clearSession(queryClient);
      void redirectToLogin(router);
    }
    async function onDisconnect(reason: string) {
      if (reason !== 'io server disconnect') return;
      try {
        const current = await queryClient.fetchQuery({ ...sessionQuery, staleTime: 0 });
        if (current) return; // still signed in: the socket stays disconnected until a reload (no reconnect after a server-side disconnect); reconnect with backoff is a Phase 3 follow-up (see roadmap)
      } catch {
        return; // /api/me is down: stay as we are, the next request will tell
      }
      clearSession(queryClient);
      void redirectToLogin(router);
    }
    socket.on('connect_error', onConnectError);
    socket.on('disconnect', onDisconnect);
    connectSocket();
    return () => {
      socket.off('connect_error', onConnectError);
      socket.off('disconnect', onDisconnect);
      disconnectSocket();
    };
  }, [userId, queryClient, router]);

  return <Outlet />;
}
