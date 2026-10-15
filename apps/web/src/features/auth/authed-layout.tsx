import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouter } from '@tanstack/react-router';
import { connectSocket, disconnectSocket, getSocket } from '@/lib/socket';
import { redirectToLogin } from './go-to-login';
import { clearSession, useSession } from './use-session';

/**
 * Layout of every signed-in screen. Owns the realtime connection: it opens once the session
 * is known and closes when the session goes (logout, 401) or the layout goes away. The server refuses a handshake without a
 * session with `unauthorized`: the session is gone, so go to /login (Socket.IO does not retry
 * after that error, and we do not either). `server_error` only means "try later", the user
 * stays signed in.
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
    socket.on('connect_error', onConnectError);
    connectSocket();
    return () => {
      socket.off('connect_error', onConnectError);
      disconnectSocket();
    };
  }, [userId, queryClient, router]);

  return <Outlet />;
}
